import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  WalletHandle,
  JsSpendableNote,
  JsBuiltTransaction,
} from '@zcash-app/core';
import { send, SendOptions, quoteFee, warmupProver } from './send.js';
import { ZcashClient, TreeState } from './client.js';
import { accountFromMnemonic } from './keys.js';
import { KNOWN_TEST_MNEMONICS } from './constants.js';

describe('P5: Async Proving, Send Pipeline, and Pending-Spend Tracking', () => {
  const acct = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const validUfvk = acct.getUnifiedFullViewingKey();
  let tmpDir: string;
  let dbPath: string;
  let wallet: WalletHandle;

  function runSql(sql: string): string {
    return execFileSync('/usr/bin/sqlite3', [dbPath, sql], { encoding: 'utf8' }).trim();
  }

  function isNotePending(noteId: number): boolean {
    const res = runSql(
      `SELECT count(*) FROM pending_spends WHERE note_id = ${noteId} AND state IN ('reserved', 'broadcast', 'mined');`
    );
    return parseInt(res, 10) > 0;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-sdk-send-test-'));
    dbPath = path.join(tmpDir, 'wallet_send_test.db');
    wallet = WalletHandle.open(dbPath, 'regtest', validUfvk, 'acct0');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  function insertMockNote(
    id: number,
    valueZatoshis: number,
    height: number,
    nullifierHex: string
  ): void {
    const sql = `
      INSERT OR REPLACE INTO received_notes (
        id, account_id, pool, txid, action_index, height, recipient,
        value_zatoshis, nullifier, rho, rseed, cmx,
        tree_position, scope, memo, spent_in_txid, spent_at_height
      ) VALUES (
        ${id}, 'acct0', 'ironwood', X'${'11'.repeat(32)}', 0, ${height}, 'uregtest1...',
        ${valueZatoshis}, X'${nullifierHex}', X'${'22'.repeat(32)}', X'${'33'.repeat(32)}', X'${'44'.repeat(32)}',
        0, 'external', NULL, NULL, NULL
      );
    `;
    runSql(sql);
  }

  function createMockClient(): ZcashClient {
    return {
      config: { network: 'regtest', endpoint: '127.0.0.1:28137' },
      getInfo: vi.fn().mockResolvedValue({ blockHeight: '10' }),
      getTreeState: vi.fn().mockResolvedValue({
        network: 'regtest',
        height: '5',
        hash: '00'.repeat(32),
        time: 1000,
        saplingTree: '00',
        orchardTree: '00',
        ironwoodTree: '000000',
      } as TreeState),
      sendTransaction: vi.fn().mockResolvedValue({ errorCode: 0, errorMessage: '' }),
      getBlockRange: vi.fn(),
      getRawBlockRange: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {},
      }),
      getAddressUtxos: vi.fn().mockResolvedValue([]),
      getBlockHeader: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZcashClient;
  }

  it('Scenario 1: Two concurrent send() calls on the same note: exactly 1 succeeds, other fails with insufficient funds', async () => {
    insertMockNote(1, 500_000_000, 2, 'aa'.repeat(32));

    const mockClient = createMockClient();

    // Mock tree root at anchor height 5
    const dummyRoot = Buffer.alloc(32, 0x12);
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(dummyRoot);

    // Mock buildAndProveTransaction with delay to simulate proving work
    let buildCallCount = 0;
    vi.spyOn(wallet, 'buildAndProveTransaction').mockImplementation(async () => {
      buildCallCount++;
      await new Promise((r) => setTimeout(r, 50));
      return {
        txid: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        rawBytes: Buffer.alloc(100, 0x01),
        fee: 10000,
        numActions: 2,
        expiryHeight: 50,
      } as JsBuiltTransaction;
    });

    // Mock querySpendableNotes to return note 1 only if NOT currently reserved in DB
    vi.spyOn(wallet, 'querySpendableNotes').mockImplementation(() => {
      if (isNotePending(1)) {
        return [];
      }
      return [
        {
          id: 1,
          recipient: 'uregtest1...',
          valueZatoshis: 500_000_000,
          nullifier: 'aa'.repeat(32),
          height: 2,
          treePosition: 0,
        },
      ];
    });

    const sendOpts1: SendOptions = {
      client: mockClient,
      wallet,
      from: 0,
      to: 'uregtest1recipientaddress...',
      amount: 300_000_000n,
    };
    const sendOpts2: SendOptions = {
      client: mockClient,
      wallet,
      from: 0,
      to: 'uregtest1recipientaddress...',
      amount: 300_000_000n,
    };

    // Launch both sends concurrently
    const results = await Promise.allSettled([send(sendOpts1), send(sendOpts2)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason.message).toMatch(/Insufficient funds/);
    expect(buildCallCount).toBe(1);
  });

  it('Scenario 2: Failed build releases reservation (notes returned to spendable)', async () => {
    insertMockNote(2, 500_000_000, 2, 'bb'.repeat(32));

    const mockClient = createMockClient();
    const dummyRoot = Buffer.alloc(32, 0x12);
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(dummyRoot);

    // Mock buildAndProveTransaction to simulate failure
    vi.spyOn(wallet, 'buildAndProveTransaction').mockRejectedValue(
      new Error('Prover circuit constraint failure: invalid witness')
    );

    // Mock querySpendableNotes
    vi.spyOn(wallet, 'querySpendableNotes').mockImplementation(() => {
      if (isNotePending(2)) return [];
      return [
        {
          id: 2,
          recipient: 'uregtest1...',
          valueZatoshis: 500_000_000,
          nullifier: 'bb'.repeat(32),
          height: 2,
          treePosition: 0,
        },
      ];
    });

    // 1. Initial check: Note 2 is spendable
    let spendable = wallet.querySpendableNotes(5, 1);
    expect(spendable.length).toBe(1);
    expect(spendable[0].id).toBe(2);

    // 2. Execute send - expect failure
    await expect(
      send({
        client: mockClient,
        wallet,
        from: 0,
        to: 'uregtest1recipient...',
        amount: 200_000_000n,
      })
    ).rejects.toThrow('Prover circuit constraint failure: invalid witness');

    // 3. Confirm reservation was canceled and note returned to spendable
    spendable = wallet.querySpendableNotes(5, 1);
    expect(spendable.length).toBe(1);
    expect(spendable[0].id).toBe(2);

    const count = parseInt(runSql('SELECT count(*) FROM pending_spends WHERE note_id = 2;'), 10);
    expect(count).toBe(0); // completely deleted/released
  });

  it('Scenario 3: Send during a running sync (verifies non-blocking write lock yield)', async () => {
    insertMockNote(3, 500_000_000, 2, 'cc'.repeat(32));

    const mockClient = createMockClient();
    const dummyRoot = Buffer.alloc(32, 0x12);
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(dummyRoot);

    vi.spyOn(wallet, 'buildAndProveTransaction').mockResolvedValue({
      txid: '1122334455667788112233445566778811223344556677881122334455667788',
      rawBytes: Buffer.alloc(50),
      fee: 10000,
      numActions: 2,
      expiryHeight: 50,
    } as JsBuiltTransaction);

    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 3,
        recipient: 'uregtest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'cc'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    // Start background scanning
    const scanPromise = wallet.scanBlocks([]);

    // Execute send concurrently while scanBlocks is running
    const sendPromise = send({
      client: mockClient,
      wallet,
      from: 0,
      to: 'uregtest1recipient...',
      amount: 100_000_000n,
    });

    const [scanRes, sendRes] = await Promise.all([scanPromise, sendPromise]);
    expect(scanRes).toBeDefined();
    expect(sendRes.txid).toBe('1122334455667788112233445566778811223344556677881122334455667788');
  });

  it('Scenario 4: Pending note stays excluded until mined or expires', async () => {
    insertMockNote(4, 500_000_000, 2, 'dd'.repeat(32));

    const mockClient = createMockClient();
    const dummyRoot = Buffer.alloc(32, 0x12);
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(dummyRoot);

    vi.spyOn(wallet, 'buildAndProveTransaction').mockResolvedValue({
      txid: '9988776655443322998877665544332299887766554433229988776655443322',
      rawBytes: Buffer.alloc(50),
      fee: 10000,
      numActions: 2,
      expiryHeight: 30, // expires at height 30
    } as JsBuiltTransaction);

    vi.spyOn(wallet, 'querySpendableNotes').mockImplementation(() => {
      if (isNotePending(4)) return [];
      return [
        {
          id: 4,
          recipient: 'uregtest1...',
          valueZatoshis: 500_000_000,
          nullifier: 'dd'.repeat(32),
          height: 2,
          treePosition: 0,
        },
      ];
    });

    // 1. Send transaction (which broadcasts and marks reservation as broadcast)
    const result = await send({
      client: mockClient,
      wallet,
      from: 0,
      to: 'uregtest1recipient...',
      amount: 150_000_000n,
    });

    expect(result.txid).toBe('9988776655443322998877665544332299887766554433229988776655443322');

    // 2. Verify note is recorded with state 'broadcast'
    const row = runSql('SELECT state, expiry_height FROM pending_spends WHERE note_id = 4;');
    const [state] = row.split('|');
    expect(state).toBe('broadcast');

    // 3. Query spendable notes: strictly excluded while pending broadcast
    const spendableWhilePending = wallet.querySpendableNotes(5, 1);
    expect(spendableWhilePending.length).toBe(0);

    // 4. Case A: If transaction expires without being mined on chain (simulated chain advance past expiry_height)
    runSql('DELETE FROM pending_spends WHERE expiry_height <= 50;');

    const spendableAfterExpiry = wallet.querySpendableNotes(5, 1);
    expect(spendableAfterExpiry.length).toBe(1);
    expect(spendableAfterExpiry[0].id).toBe(4);
  });

  it('verifies quoteFee and warmupProver exports', () => {
    expect(typeof warmupProver).toBe('function');
    expect(() => warmupProver()).not.toThrow();

    // ZIP-317 fee rule standard
    const fee2 = quoteFee(2);
    expect(fee2).toBe(10000n);

    const fee3 = quoteFee(3);
    expect(fee3).toBe(15000n);
  });
});
