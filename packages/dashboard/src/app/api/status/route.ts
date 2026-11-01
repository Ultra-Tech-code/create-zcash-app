import { createClient, getUpgradeName, getExpectedBranchId } from '@zcash-app/sdk';
import { NETWORK_PRESETS, Network, PresetId, resolveAllowedEndpoint } from '../../endpoints';
import {
  calculateSyncStatus,
  getPresetZebraRpcUrl,
  fetchZebraBlockchainInfo,
  redactSecretUrl,
  RawBlockchainInfo,
} from './sync';

function inferChainInfo(info: any): { chain: 'regtest' | 'testnet' | 'mainnet' | 'unknown'; signal: string } {
  const chain = (info.chainName || '').toLowerCase().trim();
  const sapling = String(info.saplingActivationHeight || '');
  const height = Number(info.blockHeight) || 0;

  if (sapling === '1') {
    return { chain: 'regtest', signal: 'Sapling activates at height 1, so this is a regtest node' };
  }
  if (chain === 'regtest') {
    return { chain: 'regtest', signal: "Chain reports 'regtest', so this is a regtest node" };
  }
  if (sapling === '280000') {
    return { chain: 'testnet', signal: 'Sapling activates at height 280000, so this is a testnet node' };
  }
  if (chain === 'test' && height >= 200000) {
    return { chain: 'testnet', signal: `Chain is 'test' at height ${height} (>= 200000), so this is a testnet node` };
  }
  if (chain === 'test' && height < 200000 && sapling !== '280000') {
    return { chain: 'regtest', signal: `Chain is 'test' at height ${height} with non-testnet Sapling (${sapling || 'unset'}), so this is a regtest node` };
  }
  if (chain === 'main' || chain === 'mainnet' || sapling === '419200') {
    return {
      chain: 'mainnet',
      signal: sapling === '419200' ? 'Sapling activates at height 419200, so this is a mainnet node' : "Chain reports 'main', so this is a mainnet node",
    };
  }
  return { chain: 'unknown', signal: `Unknown chain '${chain}'` };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const presetParam = searchParams.get('preset') as PresetId | null;
  const preset = presetParam && NETWORK_PRESETS[presetParam] ? NETWORK_PRESETS[presetParam] : null;

  const network: Network = preset ? preset.network : ((searchParams.get('network') || 'regtest') as Network);
  const queryEndpoint = searchParams.get('endpoint');
  const customEndpoint = searchParams.get('customEndpoint');

  const endpoint = resolveAllowedEndpoint({
    presetParam,
    network,
    queryEndpoint,
    customEndpoint,
  });

  try {
    const client = createClient({ endpoint, network });
    const info = await client.getInfo();
    await client.close();

    const actualBranchId = (info.consensusBranchId || '').toLowerCase().replace(/^0x/, '');
    const actualUpgradeName = getUpgradeName(actualBranchId);
    const blockHeight = Number(info.blockHeight) || 0;

    // Guard 1: Compare node's chain identity to selected network BEFORE branch-id check
    const chainInfo = inferChainInfo(info);
    const chainMismatch = chainInfo.chain !== 'unknown' && chainInfo.chain !== network;
    const chainMismatchMessage = chainMismatch
      ? `You selected ${network} but this node reports chain '${info.chainName}' (height ${info.blockHeight}). ${chainInfo.signal}. Pick the matching preset.`
      : undefined;

    // Determine network string for expected branch derivation
    const derivationNetwork =
      network === 'regtest' && (presetParam === 'regtest-nu7' || endpoint.includes('39067'))
        ? 'regtest-nu7'
        : network;

    const expectedBranchId = getExpectedBranchId(derivationNetwork, blockHeight);
    const expectedUpgradeName = getUpgradeName(expectedBranchId);

    const branchMatches = Boolean(
      !chainMismatch &&
      actualBranchId &&
      expectedBranchId &&
      actualBranchId === expectedBranchId.toLowerCase()
    );

    // Query Zebra RPC for sync percentage and node status
    let nodeSync = calculateSyncStatus(null, network, blockHeight);
    const zebraRpcUrl = getPresetZebraRpcUrl(presetParam, network);
    if (zebraRpcUrl) {
      try {
        const rawBlockchainInfo = await fetchZebraBlockchainInfo(zebraRpcUrl);
        if (rawBlockchainInfo) {
          nodeSync = calculateSyncStatus(rawBlockchainInfo, network, blockHeight);
        }
      } catch {
        // Node RPC failed or unreachable; nodeSync remains 'unknown'
      }
      nodeSync.nodeRpcUrl = redactSecretUrl(zebraRpcUrl);
    }

    return Response.json({
      success: true,
      preset: presetParam || undefined,
      network,
      endpoint,
      blocks: nodeSync.blocks,
      headers: nodeSync.headers,
      estimatedHeight: nodeSync.estimatedHeight,
      verificationProgress: nodeSync.verificationProgress,
      syncPercent: nodeSync.syncPercent,
      syncState: nodeSync.syncState,
      indexerBehind: nodeSync.indexerBehind,
      indexerBehindMessage: nodeSync.indexerBehindMessage,
      info: {
        ...info,
        upgradeName: actualUpgradeName,
        actualBranchId,
        expectedBranchId,
        expectedUpgradeName,
        branchMatches,
        chainMismatch,
        chainMismatchMessage,
        blocks: nodeSync.blocks,
        headers: nodeSync.headers,
        estimatedHeight: nodeSync.estimatedHeight,
        verificationProgress: nodeSync.verificationProgress,
        syncPercent: nodeSync.syncPercent,
        syncState: nodeSync.syncState,
        indexerBehind: nodeSync.indexerBehind,
        indexerBehindMessage: nodeSync.indexerBehindMessage,
        nodeSync,
      },
      nodeSync,
    });
  } catch (err: any) {
    let nodeSync = calculateSyncStatus(null, network);
    try {
      const zebraRpcUrl = getPresetZebraRpcUrl(presetParam, network);
      if (zebraRpcUrl) {
        const rawBlockchainInfo = await fetchZebraBlockchainInfo(zebraRpcUrl);
        if (rawBlockchainInfo) {
          nodeSync = calculateSyncStatus(rawBlockchainInfo, network, null);
        }
        nodeSync.nodeRpcUrl = redactSecretUrl(zebraRpcUrl);
      }
    } catch {
      // Ignored
    }

    return Response.json(
      {
        success: false,
        preset: presetParam || undefined,
        network,
        endpoint,
        error: err.message || 'Failed to connect to indexer',
        blocks: nodeSync.blocks,
        headers: nodeSync.headers,
        estimatedHeight: nodeSync.estimatedHeight,
        verificationProgress: nodeSync.verificationProgress,
        syncPercent: nodeSync.syncPercent,
        syncState: nodeSync.syncState,
        indexerBehind: nodeSync.indexerBehind,
        indexerBehindMessage: nodeSync.indexerBehindMessage,
        nodeSync,
      },
      { status: 502 }
    );
  }
}
