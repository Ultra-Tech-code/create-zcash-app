import { WalletHandle, WalletSummary, JsScanResult, JsSpendableNote, decodeIronwoodFrontierRoot } from '@zcash-app/core';
import { ZcashClient, TreeState } from './client.js';

export { decodeIronwoodFrontierRoot };

export interface SyncOptions {
  batchSize?: number;
  startHeight?: number;
  birthday?: number;
  endHeight?: number;
  onProgress?: (lastScannedHeight: number, tipHeight: number, notesDetected: number) => void;
  verifyRootAtTip?: boolean;
}

export interface WalletSyncResult {
  summary: WalletSummary;
  blocksFetched: number;
  tipHeight: number;
  treeRootHex: string | null;
  treeStateMatched: boolean;
}

/**
 * Synchronizes a WalletHandle against a live Zaino/Zcash indexer with streaming,
 * reorg resolution via resolveReorg, and root verification against GetTreeState.
 */
export async function syncWallet(
  client: ZcashClient,
  wallet: WalletHandle,
  options: SyncOptions = {}
): Promise<WalletSyncResult> {
  const batchSize = options.batchSize ?? 50;
  const initialSummary = wallet.getWalletSummary();
  const info = await client.getInfo();
  const tipHeight = Number(info.blockHeight);

  // Scan starts from startHeight, or if lastScannedHeight === 0, birthday or 2, else lastScannedHeight + 1
  let currentStart = options.startHeight ?? (
    initialSummary.lastScannedHeight === 0
      ? (options.birthday ?? 2)
      : initialSummary.lastScannedHeight + 1
  );
  const targetEnd = options.endHeight ? Math.min(options.endHeight, tipHeight) : tipHeight;

  if (currentStart > targetEnd) {
    console.log(`[Sync] Wallet already synced at height ${initialSummary.lastScannedHeight} (target end: ${targetEnd}). Fetching 0 blocks.`);
    const rootBuf = wallet.getTreeRoot(0);
    const tipRootHex = rootBuf ? rootBuf.toString('hex') : null;
    let treeStateMatched = true;

    if (options.verifyRootAtTip !== false && targetEnd === tipHeight && tipHeight >= 2) {
      try {
        const treeState = await client.getTreeState(tipHeight);
        if (treeState.ironwoodTree && treeState.ironwoodTree !== '000000') {
          const derivedRootHex = decodeIronwoodFrontierRoot(treeState.ironwoodTree);
          treeStateMatched = (tipRootHex === derivedRootHex);
        }
      } catch (e: any) {
        treeStateMatched = false;
      }
    }

    return {
      summary: initialSummary,
      blocksFetched: 0,
      tipHeight,
      treeRootHex: tipRootHex,
      treeStateMatched,
    };
  }

  console.log(`[Sync] Starting sync from height ${currentStart} to target ${targetEnd} (tip: ${tipHeight}, batch size: ${batchSize})...`);
  let totalBlocksFetched = 0;

  while (currentStart <= targetEnd) {
    const currentEnd = Math.min(currentStart + batchSize - 1, targetEnd);
    const rawBlocks: Buffer[] = [];

    // Stream raw compact blocks for the batch
    for await (const rawBlock of client.getRawBlockRange(currentStart, currentEnd)) {
      rawBlocks.push(rawBlock);
    }

    if (rawBlocks.length === 0) {
      break;
    }

    totalBlocksFetched += rawBlocks.length;
    const scanRes = (await wallet.scanBlocks(rawBlocks)) as JsScanResult;

    if (scanRes.status === 'need_ancestor_hashes') {
      const fromHeight = scanRes.fromHeight!;
      const count = scanRes.count!;
      console.warn(`[Sync] Reorganization detected at height ${fromHeight}. Fetching ${count} ancestor hashes...`);

      const ancestorHashes: Buffer[] = [];
      for (let h = fromHeight; h > Math.max(1, fromHeight - count); h--) {
        const header = await client.getBlockHeader(h);
        ancestorHashes.push(header.hash);
      }

      const commonAncestor = wallet.resolveReorg(fromHeight, ancestorHashes);
      console.log(`[Sync] Reorg resolved back to common ancestor height ${commonAncestor}. Resuming stream.`);
      currentStart = commonAncestor + 1;
      continue;
    }

    if (options.onProgress) {
      options.onProgress(scanRes.lastScannedHeight, targetEnd, scanRes.notesDetected);
    }

    currentStart = (scanRes.lastScannedHeight != null && scanRes.lastScannedHeight > 0)
      ? scanRes.lastScannedHeight + 1
      : currentEnd + 1;
  }

  const finalSummary = wallet.getWalletSummary();
  const tipRootBuf = wallet.getTreeRoot(0);
  const tipRootHex = tipRootBuf ? tipRootBuf.toString('hex') : null;

  let treeStateMatched = true;
  if (options.verifyRootAtTip !== false && targetEnd === tipHeight && tipHeight >= 2) {
    try {
      const treeState = await client.getTreeState(tipHeight);
      console.log(`[Sync] Verified against GetTreeState(${tipHeight}):`);
      console.log(`  Wallet Ironwood Root:  ${tipRootHex}`);
      console.log(`  Zaino ironwoodTree:    ${treeState.ironwoodTree}`);
      if (treeState.ironwoodTree && treeState.ironwoodTree !== '000000') {
        const derivedRootHex = decodeIronwoodFrontierRoot(treeState.ironwoodTree);
        console.log(`  Derived Zaino Root:    ${derivedRootHex}`);
        treeStateMatched = (tipRootHex === derivedRootHex);
        if (!treeStateMatched) {
          console.warn(`[Sync] Mismatch! Wallet root ${tipRootHex} != Zaino frontier root ${derivedRootHex}`);
        }
      }
    } catch (e: any) {
      console.warn(`[Sync] Warning: GetTreeState verification returned error: ${e.message}`);
      treeStateMatched = false;
    }
  }

  return {
    summary: finalSummary,
    blocksFetched: totalBlocksFetched,
    tipHeight,
    treeRootHex: tipRootHex,
    treeStateMatched,
  };
}
