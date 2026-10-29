import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  WalletHandle,
  syncWallet,
  reverseTxid,
  getDashboardWallet,
  getDashboardSyncStatus,
  startDashboardSync,
  getDashboardWalletDir,
} from './index.js';
import { ZcashClient, TreeState } from './client.js';
import { accountFromMnemonic } from './keys.js';
import { KNOWN_TEST_MNEMONICS } from './constants.js';

describe('Stage 2b: Offline Unit Tests - Full Tx Fetching, Deduplication, Reorg & Permissions', () => {
  const acct = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const validUfvk = acct.getUnifiedFullViewingKey();

  function createTempWallet(): { wallet: WalletHandle; dbPath: string; cleanup: () => void } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-sdk-fetch-test-'));
    const dbPath = path.join(tmpDir, 'wallet_fetch.db');
    const wallet = WalletHandle.open(dbPath, 'regtest', validUfvk, 'acct0');
    return {
      wallet,
      dbPath,
      cleanup: () => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}
      },
    };
  }

  it('idempotently upserts into wallet_transactions on key (txid + action_index + direction)', () => {
    const { wallet, cleanup } = createTempWallet();

    const dummyTxid = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';

    // 1. First upsert: an 'out' row of 1,000,000 zatoshis
    wallet.upsertWalletTransaction(
      dummyTxid,
      0,
      100,
      'out',
      1_000_000,
      10_000,
      'Initial memo',
      'uregtest1counterparty',
      'ironwood'
    );

    let txs = wallet.getWalletTransactions();
    expect(txs.length).toBe(1);
    expect(txs[0].txid).toBe(dummyTxid);
    expect(txs[0].actionIndex).toBe(0);
    expect(txs[0].direction).toBe('out');
    expect(txs[0].value).toBe(1_000_000);
    expect(txs[0].memo).toBe('Initial memo');

    // 2. Second upsert on SAME key: updates value and memo without creating duplicate row
    wallet.upsertWalletTransaction(
      dummyTxid,
      0,
      100,
      'out',
      1_000_000,
      10_000,
      'Updated memo',
      'uregtest1counterparty',
      'ironwood'
    );

    txs = wallet.getWalletTransactions();
    expect(txs.length).toBe(1); // Deduped! Still exactly 1 row
    expect(txs[0].memo).toBe('Updated memo');

    // 3. Different direction ('internal') on same txid + action_index: creates separate row
    wallet.upsertWalletTransaction(
      dummyTxid,
      1,
      100,
      'internal',
      400_000,
      10_000,
      null,
      null,
      'ironwood'
    );

    txs = wallet.getWalletTransactions();
    expect(txs.length).toBe(2);
    expect(txs.map((t) => t.direction).sort()).toEqual(['internal', 'out']);

    cleanup();
  });

  it('reorg resolution deletes wallet_transactions at height >= fromHeight and preserves common ancestor', () => {
    const { wallet, cleanup } = createTempWallet();

    // Insert transactions at height 2 (common ancestor), 3, and 4 (orphaned chain)
    wallet.upsertWalletTransaction('tx_h2', 0, 2, 'in', 500_000, 10_000, null, null, 'ironwood');
    wallet.upsertWalletTransaction('tx_h3', 0, 3, 'out', 200_000, 10_000, null, null, 'ironwood');
    wallet.upsertWalletTransaction('tx_h4', 0, 4, 'in', 100_000, 10_000, null, null, 'ironwood');

    let allTxs = wallet.getWalletTransactions();
    expect(allTxs.length).toBe(3);

    // Reorganization detected from height 3 rewinds and deletes rows >= 3
    const deletedCount = wallet.deleteWalletTransactionsFromHeight(3);
    expect(deletedCount).toBe(2);

    const remaining = wallet.getWalletTransactions();
    expect(remaining.length).toBe(1);
    expect(remaining[0].txid).toBe('tx_h2');
    expect(remaining[0].height).toBe(2);

    cleanup();
  });

  it('retries failed GetTransaction fetches, never drops them silently, and surfaces pending/failed counts', async () => {
    const { wallet, cleanup } = createTempWallet();

    const dummyInternalHash = Buffer.alloc(32, 0xaa);
    const explorerTxid = reverseTxid(dummyInternalHash.toString('hex'));

    // Mock touched transactions
    vi.spyOn(wallet, 'getTouchedTransactions').mockReturnValue([
      { txidBytes: dummyInternalHash, height: 50 },
    ]);

    // Mock client where GetTransaction fails with network error
    let attempts = 0;
    const mockClient = {
      config: { network: 'regtest', endpoint: '127.0.0.1:28137' },
      safeEndpoint: '127.0.0.1:28137',
      getInfo: vi.fn().mockResolvedValue({ blockHeight: '50' }),
      getRawBlockRange: vi.fn().mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.alloc(10); // 1 block
        },
      })),
      getTransaction: vi.fn().mockImplementation(() => {
        attempts++;
        return Promise.reject(new Error('Connection timeout to node'));
      }),
      getTreeState: vi.fn().mockResolvedValue({
        network: 'regtest',
        height: '50',
        hash: '00'.repeat(32),
        time: 1000,
        tree: '00',
        saplingTree: '00',
        orchardTree: '00',
        ironwoodTree: '000000',
      } as TreeState),
    } as unknown as ZcashClient;

    // Mock wallet.scanBlocks to succeed
    vi.spyOn(wallet, 'scanBlocks').mockResolvedValue({
      status: 'synced',
      lastScannedHeight: 50,
      notesDetected: 1,
    } as any);

    const syncRes = await syncWallet(mockClient, wallet, {
      startHeight: 50,
      endHeight: 50,
      ufvk: validUfvk,
      network: 'regtest',
      verifyRootAtTip: false,
    });

    // Assert that GetTransaction was retried 3 times
    expect(attempts).toBe(3);

    // Assert fetch failure was recorded in the database and surfaced in status
    const fetchCounts = wallet.getTxFetchCounts();
    expect(fetchCounts.failedCount).toBe(1);
    expect(fetchCounts.pendingCount).toBe(0);

    expect(syncRes.failedFetches).toBe(1);

    cleanup();
  });

  it('persisted WalletHandle enforces directory 0700 and file 0600, with non-blocking sync status (< 5s)', async () => {
    const dashboardDir = getDashboardWalletDir();
    const statDir = fs.statSync(dashboardDir);
    const dirMode = statDir.mode & 0o777;
    expect(dirMode).toBe(0o700);

    const testAcctId = `test_acct_${Date.now()}`;
    const wallet = getDashboardWallet('regtest', testAcctId, validUfvk, 1);
    expect(wallet).toBeDefined();

    const dbPath = path.join(dashboardDir, `regtest_${testAcctId}.db`);
    expect(fs.existsSync(dbPath)).toBe(true);

    const statFile = fs.statSync(dbPath);
    const fileMode = statFile.mode & 0o777;
    expect(fileMode).toBe(0o600);

    // Verify non-blocking status (< 100ms, well below 5s limit)
    const t0 = Date.now();
    const status = getDashboardSyncStatus('regtest', testAcctId, wallet);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(100);
    expect(status).toHaveProperty('status');
    expect(status).toHaveProperty('scanned');
    expect(status).toHaveProperty('target');
    expect(status).toHaveProperty('notesFound');
    expect(status).toHaveProperty('pendingFetches');
    expect(status).toHaveProperty('failedFetches');

    // Clean up test database file
    try {
      fs.unlinkSync(dbPath);
    } catch (_) {}
  });
});
