import {
  WalletHandle,
  WalletSummary,
  JsScanResult,
  decodeIronwoodFrontierRoot,
} from '@zcash-app/core';
import { ZcashClient, TreeState } from './client.js';

export { decodeIronwoodFrontierRoot };

export interface CheckpointVerification {
  height: number;
  expectedRootHex?: string;
}

export interface CheckpointResult {
  height: number;
  matched: boolean;
  walletRoot: string | null;
  remoteRoot: string | null;
}

export interface SyncOptions {
  batchSize?: number;
  startHeight?: number;
  birthday?: number;
  endHeight?: number;
  targetHeight?: number;
  onProgress?: (lastScannedHeight: number, tipHeight: number, notesDetected: number) => void;
  verifyRootAtTip?: boolean;
  throttleMs?: number;
  maxRetries?: number;
  checkpoints?: CheckpointVerification[];
}

export interface WalletSyncResult {
  summary: WalletSummary;
  blocksFetched: number;
  tipHeight: number;
  treeRootHex: string | null;
  treeStateMatched: boolean;
  totalRequests: number;
  elapsedMs: number;
  blocksPerSecond: number;
  checkpointResults: CheckpointResult[];
}

/**
 * Synchronizes a WalletHandle against a live Zaino/Zcash indexer with streaming,
 * reorg resolution via resolveReorg, request throttling, exponential backoff,
 * and root verification against GetTreeState.
 */
export async function syncWallet(
  client: ZcashClient,
  wallet: WalletHandle,
  options: SyncOptions = {}
): Promise<WalletSyncResult> {
  const batchSize = options.batchSize ?? 1000;
  const throttleMs = options.throttleMs ?? 50;
  const maxRetries = options.maxRetries ?? 5;
  const endpointLabel = `(${client.safeEndpoint}) (third-party server)`;

  const initialSummary = wallet.getWalletSummary();
  const info = await client.getInfo();
  const tipHeight = Number(info.blockHeight);

  let currentStart = options.startHeight ?? (
    initialSummary.lastScannedHeight === 0
      ? (options.birthday ?? 2)
      : initialSummary.lastScannedHeight + 1
  );
  const targetEnd = options.endHeight
    ? Math.min(options.endHeight, tipHeight)
    : options.targetHeight
      ? Math.min(options.targetHeight, tipHeight)
      : tipHeight;

  let totalRequests = 1; // 1 for getInfo
  const startTime = Date.now();
  let totalBlocksFetched = 0;
  const checkpointResults: CheckpointResult[] = [];

  if (currentStart > targetEnd) {
    console.log(
      `[Sync] ${endpointLabel} Wallet already synced at height ${initialSummary.lastScannedHeight} (target end: ${targetEnd}). Fetching 0 blocks.`
    );
    const rootBuf = wallet.getTreeRoot(0);
    const tipRootHex = rootBuf ? rootBuf.toString('hex') : null;
    let treeStateMatched = true;

    if (options.verifyRootAtTip !== false && targetEnd === tipHeight && tipHeight >= 2) {
      try {
        totalRequests++;
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
      totalRequests,
      elapsedMs: Date.now() - startTime,
      blocksPerSecond: 0,
      checkpointResults,
    };
  }

  console.log(
    `[Sync] ${endpointLabel} Starting sync from height ${currentStart} to target ${targetEnd} (tip: ${tipHeight}, batch size: ${batchSize}, throttle: ${throttleMs}ms)...`
  );

  async function fetchRangeWithRetry(start: number, end: number): Promise<Buffer[]> {
    let attempt = 0;
    while (true) {
      attempt++;
      totalRequests++;
      try {
        const blocks: Buffer[] = [];
        for await (const rawBlock of client.getRawBlockRange(start, end)) {
          blocks.push(rawBlock);
        }
        return blocks;
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        const isRetryable =
          errMsg.includes('14 UNAVAILABLE') ||
          errMsg.includes('8 RESOURCE_EXHAUSTED') ||
          errMsg.includes('DEADLINE_EXCEEDED') ||
          errMsg.includes('ECONNRESET') ||
          errMsg.includes('ETIMEDOUT');

        if (isRetryable && attempt <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000) + Math.floor(Math.random() * 200);
          console.warn(
            `[Sync] ${endpointLabel} Fetch range ${start}..${end} failed (${errMsg}). Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  while (currentStart <= targetEnd) {
    const currentEnd = Math.min(currentStart + batchSize - 1, targetEnd);
    const batchStartMs = Date.now();
    const rawBlocks = await fetchRangeWithRetry(currentStart, currentEnd);

    if (rawBlocks.length === 0) {
      break;
    }

    totalBlocksFetched += rawBlocks.length;

    // Scan raw blocks into WalletHandle in chunks to respect Rust time-bounded transactions
    let slice = rawBlocks;
    let sliceCursor = currentStart;
    while (slice.length > 0) {
      const scanRes = (await wallet.scanBlocks(slice)) as JsScanResult;

      if (scanRes.status === 'need_ancestor_hashes') {
        const fromHeight = scanRes.fromHeight!;
        const count = scanRes.count!;
        console.warn(
          `[Sync] ${endpointLabel} Reorganization detected at height ${fromHeight}. Fetching ${count} ancestor hashes...`
        );

        const ancestorHashes: Buffer[] = [];
        for (let h = fromHeight; h > Math.max(1, fromHeight - count); h--) {
          totalRequests++;
          const header = await client.getBlockHeader(h);
          ancestorHashes.push(header.hash);
        }

        const commonAncestor = wallet.resolveReorg(fromHeight, ancestorHashes);
        console.log(
          `[Sync] ${endpointLabel} Reorg resolved back to common ancestor height ${commonAncestor}. Resuming stream.`
        );
        currentStart = commonAncestor + 1;
        slice = [];
        break;
      }

      if (options.onProgress) {
        options.onProgress(scanRes.lastScannedHeight, targetEnd, scanRes.notesDetected);
      }

      const numScanned = scanRes.lastScannedHeight - sliceCursor + 1;
      slice = slice.slice(numScanned);
      sliceCursor = scanRes.lastScannedHeight + 1;
    }

    const elapsedTotal = Math.max(1, Date.now() - startTime);
    const rollingBps = (totalBlocksFetched / (elapsedTotal / 1000)).toFixed(1);
    const pct = (((currentEnd - options.startHeight! + 1) / (targetEnd - options.startHeight! + 1)) * 100).toFixed(1);

    if (totalBlocksFetched % 5000 === 0 || currentEnd >= targetEnd || rawBlocks.length < batchSize) {
      console.log(
        `[Sync] ${endpointLabel} Height: ${currentEnd}/${targetEnd} (${pct}%) | Req: ${totalRequests} | Speed: ${rollingBps} blocks/s`
      );
    }

    currentStart = sliceCursor;

    // Politeness throttling between stream batches
    if (throttleMs > 0 && currentStart <= targetEnd) {
      await new Promise((r) => setTimeout(r, throttleMs));
    }
  }

  // Checkpoint verifications against GetTreeState
  if (options.checkpoints && options.checkpoints.length > 0) {
    console.log(`[Sync] ${endpointLabel} Verifying checkpoints against GetTreeState...`);
    for (const cp of options.checkpoints) {
      const h = cp.height;
      if (h <= tipHeight && h >= (options.birthday ?? 2)) {
        try {
          totalRequests++;
          const treeState = await client.getTreeState(h);
          let remoteRootHex: string | null = null;
          if (treeState.ironwoodTree && treeState.ironwoodTree !== '000000') {
            remoteRootHex = decodeIronwoodFrontierRoot(treeState.ironwoodTree);
          }
          const localBuf = wallet.getTreeRootAtHeight(h);
          const localRootHex = localBuf ? localBuf.toString('hex') : null;
          const matched = localRootHex !== null && remoteRootHex !== null && localRootHex === remoteRootHex;

          checkpointResults.push({
            height: h,
            matched,
            walletRoot: localRootHex,
            remoteRoot: remoteRootHex,
          });

          console.log(
            `[Sync] ${endpointLabel} Checkpoint ${h}: Wallet=${localRootHex} | Remote=${remoteRootHex} | Status=${matched ? 'MATCH ✅' : 'MISMATCH ❌'}`
          );
        } catch (e: any) {
          console.warn(`[Sync] ${endpointLabel} Checkpoint ${h} verification error: ${e.message}`);
          checkpointResults.push({
            height: h,
            matched: false,
            walletRoot: null,
            remoteRoot: null,
          });
        }
      }
    }
  }

  const finalSummary = wallet.getWalletSummary();
  const tipRootBuf = wallet.getTreeRoot(0);
  const tipRootHex = tipRootBuf ? tipRootBuf.toString('hex') : null;

  let treeStateMatched = true;
  if (options.verifyRootAtTip !== false && targetEnd === tipHeight && tipHeight >= 2) {
    try {
      totalRequests++;
      const treeState = await client.getTreeState(tipHeight);
      console.log(`[Sync] ${endpointLabel} Verified against GetTreeState(${tipHeight}):`);
      console.log(`  Wallet Ironwood Root:  ${tipRootHex}`);
      console.log(`  Remote ironwoodTree:   ${treeState.ironwoodTree}`);
      if (treeState.ironwoodTree && treeState.ironwoodTree !== '000000') {
        const derivedRootHex = decodeIronwoodFrontierRoot(treeState.ironwoodTree);
        console.log(`  Derived Remote Root:   ${derivedRootHex}`);
        treeStateMatched = (tipRootHex === derivedRootHex);
        if (!treeStateMatched) {
          console.warn(
            `[Sync] ${endpointLabel} Mismatch! Wallet root ${tipRootHex} != Remote frontier root ${derivedRootHex}`
          );
        }
      }
    } catch (e: any) {
      console.warn(`[Sync] ${endpointLabel} Warning: GetTreeState verification returned error: ${e.message}`);
      treeStateMatched = false;
    }
  }

  const totalElapsed = Date.now() - startTime;
  const blocksPerSecond = Number((totalBlocksFetched / (Math.max(1, totalElapsed) / 1000)).toFixed(1));

  return {
    summary: finalSummary,
    blocksFetched: totalBlocksFetched,
    tipHeight,
    treeRootHex: tipRootHex,
    treeStateMatched,
    totalRequests,
    elapsedMs: totalElapsed,
    blocksPerSecond,
    checkpointResults,
  };
}
