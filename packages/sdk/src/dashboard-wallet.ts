import fs from 'fs';
import os from 'os';
import path from 'path';
import { WalletHandle } from '@zcash-app/core';
import { ZcashClient } from './client.js';
import { syncWallet, SyncOptions } from './sync.js';

/**
 * SECURITY NOTICE:
 * Memos and counterparties are stored in plaintext in the SQLite wallet database.
 * To protect user privacy, directory permissions are strictly enforced to 0700
 * and database files to 0600.
 */

export interface DashboardSyncStatus {
  status: 'idle' | 'syncing' | 'synced' | 'error';
  scanned: number;
  target: number;
  notesFound: number;
  pendingFetches: number;
  failedFetches: number;
  error?: string;
  lastSyncedAt?: number;
}

const walletCache = new Map<string, WalletHandle>();
const syncStatusMap = new Map<string, DashboardSyncStatus>();
const syncPromiseMap = new Map<string, Promise<void>>();

export function getDashboardWalletDir(): string {
  const dir = path.join(os.homedir(), '.zcash-app', 'dashboard');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_) {}
  return dir;
}

export function getDashboardWalletPath(network: string, accountId: string): string {
  const dir = getDashboardWalletDir();
  const safeNetwork = network.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const safeAccount = accountId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return path.join(dir, `${safeNetwork}_${safeAccount}.db`);
}

/**
 * Opens or retrieves a cached WalletHandle for the given (network, account)
 * persisted under ~/.zcash-app/dashboard/ with strict 0700 dir and 0600 file permissions.
 */
export function getDashboardWallet(
  network: string,
  accountId: string,
  ufvk: string,
  birthday?: number
): WalletHandle {
  const cacheKey = `${network.toLowerCase()}:${accountId.toLowerCase()}`;
  const existing = walletCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const dbPath = getDashboardWalletPath(network, accountId);
  const wallet = WalletHandle.open(dbPath, network, ufvk, accountId, birthday);

  // Enforce 0600 on the database file
  if (fs.existsSync(dbPath)) {
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch (_) {}
  }

  walletCache.set(cacheKey, wallet);
  return wallet;
}

/**
 * Returns the current background sync status immediately without blocking.
 */
export function getDashboardSyncStatus(
  network: string,
  accountId: string,
  wallet?: WalletHandle
): DashboardSyncStatus {
  const key = `${network.toLowerCase()}:${accountId.toLowerCase()}`;
  let status = syncStatusMap.get(key);

  if (!status) {
    let scanned = 0;
    let notesFound = 0;
    let pendingFetches = 0;
    let failedFetches = 0;

    if (wallet) {
      try {
        const summary = wallet.getWalletSummary();
        scanned = summary.lastScannedHeight;
        notesFound = summary.unspentNotesCount;
        const fetchCounts = wallet.getTxFetchCounts();
        pendingFetches = fetchCounts.pendingCount;
        failedFetches = fetchCounts.failedCount;
      } catch (_) {}
    }

    status = {
      status: 'idle',
      scanned,
      target: scanned,
      notesFound,
      pendingFetches,
      failedFetches,
    };
    syncStatusMap.set(key, status);
  } else if (wallet && status.status !== 'syncing') {
    // Refresh counts from wallet if idle/synced/error
    try {
      const summary = wallet.getWalletSummary();
      status.scanned = summary.lastScannedHeight;
      status.notesFound = summary.unspentNotesCount;
      const fetchCounts = wallet.getTxFetchCounts();
      status.pendingFetches = fetchCounts.pendingCount;
      status.failedFetches = fetchCounts.failedCount;
    } catch (_) {}
  }

  return { ...status };
}

/**
 * Initiates an asynchronous background synchronization job if one is not already running.
 * Returns immediately without blocking (< 50ms) so no API endpoint blocks.
 */
export function startDashboardSync(
  client: ZcashClient,
  wallet: WalletHandle,
  options: SyncOptions = {}
): DashboardSyncStatus {
  const network = options.network ?? (wallet as any).network ?? client.config?.network ?? 'testnet';
  const accountId = 'account0';
  const key = `${network.toLowerCase()}:${accountId.toLowerCase()}`;

  // If already syncing, return current status immediately
  if (syncPromiseMap.has(key)) {
    return getDashboardSyncStatus(network, accountId, wallet);
  }

  const currentSummary = wallet.getWalletSummary();
  const currentFetchCounts = wallet.getTxFetchCounts();

  const statusObj: DashboardSyncStatus = {
    status: 'syncing',
    scanned: currentSummary.lastScannedHeight,
    target: options.targetHeight ?? options.endHeight ?? currentSummary.lastScannedHeight,
    notesFound: currentSummary.unspentNotesCount,
    pendingFetches: currentFetchCounts.pendingCount,
    failedFetches: currentFetchCounts.failedCount,
  };
  syncStatusMap.set(key, statusObj);

  const syncPromise = (async () => {
    try {
      const result = await syncWallet(client, wallet, {
        ...options,
        onProgress: (scanned, target, notes) => {
          statusObj.scanned = scanned;
          statusObj.target = target;
          statusObj.notesFound = notes;
          try {
            const counts = wallet.getTxFetchCounts();
            statusObj.pendingFetches = counts.pendingCount;
            statusObj.failedFetches = counts.failedCount;
          } catch (_) {}
          if (options.onProgress) {
            options.onProgress(scanned, target, notes);
          }
        },
      });

      statusObj.status = 'synced';
      statusObj.scanned = result.summary.lastScannedHeight;
      statusObj.target = result.tipHeight;
      statusObj.notesFound = result.summary.unspentNotesCount;
      statusObj.pendingFetches = result.pendingFetches;
      statusObj.failedFetches = result.failedFetches;
      statusObj.lastSyncedAt = Date.now();
      statusObj.error = undefined;
    } catch (err: any) {
      statusObj.status = 'error';
      statusObj.error = err?.message ?? String(err);
      try {
        const counts = wallet.getTxFetchCounts();
        statusObj.pendingFetches = counts.pendingCount;
        statusObj.failedFetches = counts.failedCount;
      } catch (_) {}
    } finally {
      syncPromiseMap.delete(key);
    }
  })();

  syncPromiseMap.set(key, syncPromise);

  return { ...statusObj };
}
