import { NextResponse } from 'next/server';
import { createClient, getUpgradeName, getExpectedBranchId } from '@zcash-app/sdk';
import { NETWORK_PRESETS, Network, PresetId, ALLOWED_ENDPOINTS } from '../../endpoints';

function inferChainType(info: any): 'regtest' | 'testnet' | 'mainnet' | 'unknown' {
  const chain = (info.chainName || '').toLowerCase().trim();
  const sapling = String(info.saplingActivationHeight || '');
  const height = Number(info.blockHeight) || 0;

  if (chain === 'regtest' || sapling === '1' || (chain === 'test' && height < 200000 && sapling !== '280000')) {
    return 'regtest';
  }
  if (chain === 'main' || sapling === '419200') {
    return 'mainnet';
  }
  if (chain === 'test' || sapling === '280000') {
    return 'testnet';
  }
  return 'unknown';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const presetParam = searchParams.get('preset') as PresetId | null;
  const preset = presetParam && NETWORK_PRESETS[presetParam] ? NETWORK_PRESETS[presetParam] : null;

  const network: Network = preset ? preset.network : ((searchParams.get('network') || 'regtest') as Network);
  const queryEndpoint = searchParams.get('endpoint');

  let endpoint = preset ? preset.endpoint : (queryEndpoint || '127.0.0.1:28137');
  if (queryEndpoint) {
    const isAllowed =
      queryEndpoint.startsWith('127.0.0.1:') ||
      queryEndpoint.startsWith('localhost:') ||
      ALLOWED_ENDPOINTS.includes(queryEndpoint);
    if (isAllowed) {
      endpoint = queryEndpoint;
    }
  }

  try {
    const client = createClient({ endpoint, network });
    const info = await client.getInfo();
    await client.close();

    const actualBranchId = (info.consensusBranchId || '').toLowerCase().replace(/^0x/, '');
    const actualUpgradeName = getUpgradeName(actualBranchId);
    const blockHeight = Number(info.blockHeight) || 0;

    // Guard 1: Compare node's chain name to selected network BEFORE branch-id check
    const inferredChain = inferChainType(info);
    const chainMismatch = inferredChain !== 'unknown' && inferredChain !== network;
    const chainMismatchMessage = chainMismatch
      ? `You selected ${network} but this node reports chain '${info.chainName}' (height ${info.blockHeight}). This looks like a ${inferredChain} node. Pick the matching preset.`
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

    return NextResponse.json({
      success: true,
      preset: presetParam || undefined,
      network,
      endpoint,
      info: {
        ...info,
        upgradeName: actualUpgradeName,
        actualBranchId,
        expectedBranchId,
        expectedUpgradeName,
        branchMatches,
        chainMismatch,
        chainMismatchMessage,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        preset: presetParam || undefined,
        network,
        endpoint,
        error: err.message || 'Failed to connect to indexer',
      },
      { status: 502 }
    );
  }
}
