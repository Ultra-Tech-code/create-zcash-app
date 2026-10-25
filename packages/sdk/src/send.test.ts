import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  WalletHandle,
  JsSpendableNote,
  JsBuiltTransaction,
  decodeIronwoodFrontierRoot,
  ironwoodEmptyTreeRoot,
} from '@zcash-app/core';
import { send, SendOptions, quoteFee, warmupProver, AnchorVerificationError } from './send.js';
import { ZcashClient, TreeState } from './client.js';
import { accountFromMnemonic } from './keys.js';
import { KNOWN_TEST_MNEMONICS } from './constants.js';

describe('P5: Async Proving, Send Pipeline, and Pending-Spend Tracking', () => {
  const acct = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const validUfvk = acct.getUnifiedFullViewingKey();

  // A decodable Ironwood frontier plus the root it decodes to. The general-flow scenarios mock the
  // node with this frontier and the wallet checkpoint with its root, so the anchor check runs and
  // passes for real instead of being skipped by an empty-tree marker.
  const mockFrontier = '01' + Buffer.alloc(32, 0x00).toString('hex') + '00' + '00';
  const mockFrontierRoot = decodeIronwoodFrontierRoot(mockFrontier);
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
        ironwoodTree: mockFrontier,
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

    // Mock tree root at anchor height 5 (must match the mocked node frontier root)
    const dummyRoot = Buffer.from(mockFrontierRoot, 'hex');
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
    const dummyRoot = Buffer.from(mockFrontierRoot, 'hex');
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
    const dummyRoot = Buffer.from(mockFrontierRoot, 'hex');
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
    const dummyRoot = Buffer.from(mockFrontierRoot, 'hex');
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

  it('Scenario 5: send() aborts before build when the anchor root differs from the node GetTreeState root', async () => {
    insertMockNote(5, 500_000_000, 2, 'ee'.repeat(32));

    const mockClient = createMockClient();

    // Local wallet checkpoint root at the anchor height (tip 10 -> anchor 5).
    const localRoot = Buffer.alloc(32, 0x12);
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(localRoot);

    // Node reports a different, but perfectly decodable, Ironwood frontier root.
    const nodeFrontier = '01' + Buffer.alloc(32, 0x00).toString('hex') + '00' + '00';
    const nodeRootHex = decodeIronwoodFrontierRoot(nodeFrontier);
    expect(nodeRootHex).not.toBe(localRoot.toString('hex'));
    vi.spyOn(mockClient, 'getTreeState').mockResolvedValue({
      network: 'regtest',
      height: '5',
      hash: '00'.repeat(32),
      time: 1000,
      saplingTree: '00',
      orchardTree: '00',
      ironwoodTree: nodeFrontier,
    } as TreeState);

    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 5,
        recipient: 'uregtest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'ee'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    const buildSpy = vi.spyOn(wallet, 'buildAndProveTransaction');

    await expect(
      send({
        client: mockClient,
        wallet,
        from: 0,
        to: 'uregtest1recipient...',
        amount: 100_000_000n,
      })
    ).rejects.toThrow(/Tree root mismatch at anchor height 5/);

    // Aborted before proving, and no note reservation was left behind.
    expect(buildSpy).not.toHaveBeenCalled();
    expect(runSql('SELECT count(*) FROM pending_spends;')).toBe('0');
  });

  it('Scenario 6: an undecodable node frontier aborts before build and leaves no reservation', async () => {
    insertMockNote(6, 500_000_000, 2, 'f1'.repeat(32));

    const mockClient = createMockClient();
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(Buffer.alloc(32, 0x12));
    vi.spyOn(mockClient, 'getTreeState').mockResolvedValue({
      network: 'regtest',
      height: '5',
      hash: '00'.repeat(32),
      time: 1000,
      saplingTree: '00',
      orchardTree: '00',
      // Non-canonical Pallas encoding: well-formed-length but undecodable.
      ironwoodTree: '01' + 'ff'.repeat(32) + '00' + '00',
    } as TreeState);

    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 6,
        recipient: 'uregtest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'f1'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    const buildSpy = vi.spyOn(wallet, 'buildAndProveTransaction');

    await expect(
      send({
        client: mockClient,
        wallet,
        from: 0,
        to: 'uregtest1recipient...',
        amount: 100_000_000n,
      })
    ).rejects.toThrow(/Cannot verify anchor against node at height 5: undecodable Ironwood frontier/);

    expect(buildSpy).not.toHaveBeenCalled();
    expect(runSql('SELECT count(*) FROM pending_spends;')).toBe('0');
  });

  it('Scenario 7: an unreachable node aborts before build and leaves no reservation', async () => {
    insertMockNote(7, 500_000_000, 2, 'f2'.repeat(32));

    const mockClient = createMockClient();
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(Buffer.alloc(32, 0x12));
    vi.spyOn(mockClient, 'getTreeState').mockRejectedValue(new Error('14 UNAVAILABLE: connect ECONNREFUSED 127.0.0.1:28137'));

    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 7,
        recipient: 'uregtest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'f2'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    const buildSpy = vi.spyOn(wallet, 'buildAndProveTransaction');

    await expect(
      send({
        client: mockClient,
        wallet,
        from: 0,
        to: 'uregtest1recipient...',
        amount: 100_000_000n,
      })
    ).rejects.toThrow(/Cannot verify anchor against node at height 5: getTreeState failed/);

    expect(buildSpy).not.toHaveBeenCalled();
    expect(runSql('SELECT count(*) FROM pending_spends;')).toBe('0');
  });

  it('Scenario 8: an unreachable node with allowUnverifiedAnchor=true proceeds with the local root', async () => {
    insertMockNote(8, 500_000_000, 2, 'f3'.repeat(32));

    const mockClient = createMockClient();
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(Buffer.alloc(32, 0x12));
    vi.spyOn(mockClient, 'getTreeState').mockRejectedValue(new Error('14 UNAVAILABLE: connect ECONNREFUSED 127.0.0.1:28137'));

    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 8,
        recipient: 'uregtest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'f3'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    const buildSpy = vi.spyOn(wallet, 'buildAndProveTransaction').mockResolvedValue({
      txid: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
      rawBytes: Buffer.alloc(64, 0x02),
      fee: 10000,
      numActions: 2,
      expiryHeight: 50,
    } as JsBuiltTransaction);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await send({
      client: mockClient,
      wallet,
      from: 0,
      to: 'uregtest1recipient...',
      amount: 100_000_000n,
      allowUnverifiedAnchor: true,
    });

    expect(result.txid).toBe('aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899');
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(runSql('SELECT state FROM pending_spends WHERE note_id = 8;')).toBe('broadcast');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NOT verified against the node'));

    warnSpy.mockRestore();
  });

  it('Scenario 9: a node reporting an EMPTY Ironwood tree aborts when the wallet has commitments', async () => {
    insertMockNote(9, 500_000_000, 2, 'f4'.repeat(32));

    const mockClient = createMockClient();
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(Buffer.from(mockFrontierRoot, 'hex'));
    vi.spyOn(mockClient, 'getTreeState').mockResolvedValue({
      network: 'regtest',
      height: '5',
      hash: '00'.repeat(32),
      time: 1000,
      saplingTree: '00',
      orchardTree: '00',
      // Zaino's marker for "no Ironwood commitments at this height".
      ironwoodTree: '000000',
    } as TreeState);

    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 9,
        recipient: 'uregtest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'f4'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    const buildSpy = vi.spyOn(wallet, 'buildAndProveTransaction');
    const emptyRootHex = ironwoodEmptyTreeRoot();

    const err: any = await send({
      client: mockClient,
      wallet,
      from: 0,
      to: 'uregtest1recipient...',
      amount: 100_000_000n,
    }).then(
      () => null,
      (e) => e
    );

    expect(err).toBeInstanceOf(AnchorVerificationError);
    expect(err.message).toMatch(/Tree root mismatch at anchor height 5/);
    expect(err.message).toContain(emptyRootHex);
    expect(buildSpy).not.toHaveBeenCalled();
    expect(runSql('SELECT count(*) FROM pending_spends;')).toBe('0');
  });

  it('Scenario 10: an empty local checkpoint matches the node empty-tree marker (check passes)', async () => {
    insertMockNote(10, 500_000_000, 2, 'f5'.repeat(32));

    const mockClient = createMockClient();
    const emptyRootHex = ironwoodEmptyTreeRoot();
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(Buffer.from(emptyRootHex, 'hex'));
    vi.spyOn(mockClient, 'getTreeState').mockResolvedValue({
      network: 'regtest',
      height: '5',
      hash: '00'.repeat(32),
      time: 1000,
      saplingTree: '00',
      orchardTree: '00',
      ironwoodTree: '000000',
    } as TreeState);

    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 10,
        recipient: 'uregtest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'f5'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    const buildSpy = vi.spyOn(wallet, 'buildAndProveTransaction').mockResolvedValue({
      txid: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
      rawBytes: Buffer.alloc(64, 0x03),
      fee: 10000,
      numActions: 2,
      expiryHeight: 50,
    } as JsBuiltTransaction);

    const result = await send({
      client: mockClient,
      wallet,
      from: 0,
      to: 'uregtest1recipient...',
      amount: 100_000_000n,
    });

    expect(result.txid).toBe('c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00');
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(runSql('SELECT state FROM pending_spends WHERE note_id = 10;')).toBe('broadcast');
  });

  it('forbids allowUnverifiedAnchor on testnet with AnchorVerificationError', async () => {
    insertMockNote(11, 500_000_000, 2, 'f5'.repeat(32));

    const mockClient = createMockClient();
    (mockClient.config as any).network = 'testnet';
    vi.spyOn(wallet, 'getTreeRootAtHeight').mockReturnValue(Buffer.alloc(32, 0x12));
    vi.spyOn(wallet, 'querySpendableNotes').mockReturnValue([
      {
        id: 11,
        recipient: 'utest1...',
        valueZatoshis: 500_000_000,
        nullifier: 'f5'.repeat(32),
        height: 2,
        treePosition: 0,
      },
    ]);

    await expect(
      send({
        client: mockClient,
        wallet,
        from: 0,
        to: 'utest1recipient...',
        amount: 100_000_000n,
        allowUnverifiedAnchor: true,
      })
    ).rejects.toThrow(
      /allowUnverifiedAnchor is strictly forbidden on testnet/
    );
  });

  it('verifies quoteFee and warmupProver exports against FeeRule::standard()', () => {
    expect(typeof warmupProver).toBe('function');
    expect(() => warmupProver()).not.toThrow();

    // Standard ZIP-317 fee rule:
    // Marginal fee: 5,000 zatoshis per action
    // Grace actions: 2 actions
    // Minimum fee: max(actions, 2) * 5,000 zatoshis
    const testCounts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 50, 100];
    for (const n of testCounts) {
      const fee = quoteFee(n);
      const expectedActions = Math.max(n, 2);
      const expectedFee = BigInt(expectedActions) * 5000n;
      expect(fee).toBe(expectedFee);
    }
  });
});
