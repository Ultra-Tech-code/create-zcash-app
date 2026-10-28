import {
  WalletHandle,
  WalletSummary,
  JsScanResult,
  decodeIronwoodFrontierRoot,
} from '@zcash-app/core';
import { ZcashClient, TreeState } from './client.js';
import { reverseTxid } from './send.js';
import { decryptTransaction } from './decrypted-tx.js';

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
  ufvk?: string;
  network?: string;
  accountId?: string;
  fetchFullTransactions?: boolean;
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
  pendingFetches: number;
  failedFetches: number;
}

export interface TreeFrontierInitResult {
  height: number;
  treeSize: number;
  rootHex: string;
  alreadyInitialized: boolean;
}

/**
 * Initializes the wallet's commitment tree frontier from lightwalletd GetTreeState at height (birthday - 1).
 * Verified against lightwalletd v0.6.0 walletrpc/service.proto:L185 (TreeState.ironwoodTree = 7).
 *
 * Verifies that the parsed frontier tree size equals CompactBlock ironwoodCommitmentTreeSize at height (birthday - 1),
 * inserting the starting checkpoint into ShardTree and recorded in scanned_blocks.
 */
export async function initWalletTreeFrontier(
  client: ZcashClient,
  wallet: WalletHandle,
  birthday: number
): Promise<TreeFrontierInitResult> {
  const initHeight = birthday - 1;
  if (initHeight < 1) {
    throw new Error(`Invalid birthday height ${birthday}: cannot initialize frontier before height 1`);
  }

  // 1. Call lightwalletd GetTreeState(height B - 1)
  const treeState = await client.getTreeState(initHeight);
  // Read ironwoodTree field (packages/sdk/proto/service.proto:L185)
  const ironwoodTree = treeState.ironwoodTree;
  if (!ironwoodTree || ironwoodTree.trim() === '') {
    throw new Error(`Ironwood commitment tree frontier field is empty or missing in GetTreeState(${initHeight})`);
  }

  // 2. Fetch CompactBlock at height B - 1 to read chainMetadata.ironwoodCommitmentTreeSize
  const block = await client.getBlock(initHeight);
  const metadata = block.chainMetadata;
  if (!metadata || metadata.ironwoodCommitmentTreeSize === undefined) {
    throw new Error(`CompactBlock at height ${initHeight} missing chainMetadata.ironwoodCommitmentTreeSize`);
  }
  const expectedTreeSize = metadata.ironwoodCommitmentTreeSize;
  const blockHashBuf = block.hash && block.hash.length === 32 ? Buffer.from(block.hash) : undefined;

  // 3. Delegate to Core for parsing, size verification, and ShardTree insertion
  const res = wallet.initTreeFrontier(initHeight, ironwoodTree, expectedTreeSize, blockHashBuf);

  return {
    height: res.height,
    treeSize: res.treeSize,
    rootHex: res.rootHex,
    alreadyInitialized: res.alreadyInitialized,
  };
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

  let initialSummary = wallet.getWalletSummary();
  const info = await client.getInfo();
  const tipHeight = Number(info.blockHeight);
  let totalRequests = 1; // 1 for getInfo

  const bday = options.birthday;
  if (
    bday !== undefined &&
    bday > 2 &&
    (initialSummary.lastScannedHeight === 0 || wallet.isTreeEmpty())
  ) {
    console.log(
      `[Sync] ${endpointLabel} Cold start detected for birthday ${bday} with empty tree. Initializing starting frontier at height ${bday - 1}...`
    );
    const frontierInit = await initWalletTreeFrontier(client, wallet, bday);
    totalRequests += 2; // 1 for GetTreeState, 1 for GetBlock
    console.log(
      `[Sync] ${endpointLabel} Starting tree frontier initialized at height ${frontierInit.height}: size ${frontierInit.treeSize}, root ${frontierInit.rootHex} (already_init: ${frontierInit.alreadyInitialized})`
    );
    initialSummary = wallet.getWalletSummary();
  }

  let currentStart = options.startHeight ?? (
    initialSummary.lastScannedHeight === 0
      ? (options.birthday ?? 2)
      : (bday !== undefined && initialSummary.lastScannedHeight === bday - 1)
        ? bday
        : initialSummary.lastScannedHeight + 1
  );
  const syncStartHeight = currentStart;
  const targetEnd = options.endHeight
    ? Math.min(options.endHeight, tipHeight)
    : options.targetHeight
      ? Math.min(options.targetHeight, tipHeight)
      : tipHeight;

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

    const earlyFetchCounts = wallet.getTxFetchCounts();
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
      pendingFetches: earlyFetchCounts.pendingCount,
      failedFetches: earlyFetchCounts.failedCount,
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
          errMsg.includes('13 INTERNAL') ||
          errMsg.includes('INTERNAL') ||
          errMsg.includes('unexpected EOF') ||
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

    const batchScanStart = currentStart;

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
        wallet.deleteWalletTransactionsFromHeight(fromHeight);
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

    // After scanning batch: fetch full transactions for all touched txs and upsert into wallet_transactions
    const effectiveUfvk = options.ufvk ?? (wallet as any).ufvk;
    const effectiveNetwork = options.network ?? (wallet as any).network ?? client.config?.network ?? 'testnet';

    if (options.fetchFullTransactions !== false && effectiveUfvk && sliceCursor > batchScanStart) {
      const touched = wallet.getTouchedTransactions(batchScanStart, sliceCursor - 1);
      if (touched.length > 0) {
        for (const touch of touched) {
          const rawHex = touch.txidBytes.toString('hex');
          const explorerTxid = reverseTxid(rawHex);

          let txData: { data: Buffer; height: number } | null = null;
          let lastErr: any = null;

          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              totalRequests++;
              txData = await client.getTransaction(touch.txidBytes);
              break;
            } catch (err: any) {
              lastErr = err;
              if (attempt < 3) {
                await new Promise((r) => setTimeout(r, 200 * attempt));
              }
            }
          }

          if (!txData || txData.data.length === 0) {
            const errMsg = lastErr?.message ?? 'Empty data returned by GetTransaction';
            console.warn(
              `[Sync] ${endpointLabel} Failed to fetch full transaction ${explorerTxid} (attempted 3x): ${errMsg}`
            );
            wallet.recordTxFetchAttempt(explorerTxid, touch.height, 'failed', errMsg);
            continue;
          }

          try {
            const dec = decryptTransaction(effectiveUfvk, effectiveNetwork, txData.data, touch.height);

            for (const out of dec.outgoing) {
              wallet.upsertWalletTransaction(
                dec.txid,
                out.actionIndex,
                touch.height,
                'out',
                Number(out.value),
                dec.fee !== null ? Number(dec.fee) : null,
                out.memo.text ?? null,
                out.recipient,
                'ironwood'
              );
            }

            for (const inc of dec.incoming) {
              const direction = inc.isChange ? 'internal' : 'in';
              wallet.upsertWalletTransaction(
                dec.txid,
                inc.actionIndex,
                touch.height,
                direction,
                Number(inc.value),
                dec.fee !== null ? Number(dec.fee) : null,
                inc.memo.text ?? null,
                null,
                'ironwood'
              );
            }

            wallet.recordTxFetchAttempt(explorerTxid, touch.height, 'done', null);
          } catch (decErr: any) {
            console.warn(
              `[Sync] ${endpointLabel} Failed to decrypt transaction ${explorerTxid}: ${decErr.message}`
            );
            wallet.recordTxFetchAttempt(explorerTxid, touch.height, 'failed', decErr.message);
          }
        }
      }
    }

    const elapsedTotal = Math.max(1, Date.now() - startTime);
    const rollingBps = (totalBlocksFetched / (elapsedTotal / 1000)).toFixed(1);
    const totalToScan = targetEnd - syncStartHeight + 1;
    const scannedSoFar = currentEnd - syncStartHeight + 1;
    const pct = totalToScan > 0 ? Math.min(100, Math.max(0, (scannedSoFar / totalToScan) * 100)).toFixed(1) : '100.0';

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
  const fetchCounts = wallet.getTxFetchCounts();

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
    pendingFetches: fetchCounts.pendingCount,
    failedFetches: fetchCounts.failedCount,
  };
}
