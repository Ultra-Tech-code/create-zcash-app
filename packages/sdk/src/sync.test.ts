import { describe, it, expect, vi } from 'vitest';
import { syncWallet, WalletSyncResult } from './sync.js';
import { WalletHandle, decodeIronwoodFrontierRoot } from '@zcash-app/core';
import { ZcashClient, TreeState } from './client.js';
import { accountFromMnemonic } from './keys.js';
import { KNOWN_TEST_MNEMONICS } from './constants.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SDK syncWallet, Mock Block Streamer, and GetTreeState Verification', () => {
  const acct = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const validUfvk = acct.getUnifiedFullViewingKey();

  function createTempWallet(): { wallet: WalletHandle; dbPath: string; cleanup: () => void } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-sdk-sync-test-'));
    const dbPath = path.join(tmpDir, 'wallet_sync.db');
    const wallet = WalletHandle.open(dbPath, 'regtest', validUfvk, 'acct0');
    return {
      wallet,
      dbPath,
      cleanup: () => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {}
      },
    };
  }

  it('makes zero block requests when already at tip, and requests only >= last_scanned+1 on advance', async () => {
    const { wallet, cleanup } = createTempWallet();

    const requestedRanges: Array<{ start: number; end: number }> = [];

    const mockClient = {
      config: { network: 'regtest', endpoint: '127.0.0.1:28137' },
      getInfo: vi.fn().mockResolvedValue({ blockHeight: '0' }),
      getRawBlockRange: vi.fn().mockImplementation((start: number, end: number) => {
        requestedRanges.push({ start, end });
        return {
          [Symbol.asyncIterator]: async function* () {},
        };
      }),
      getTreeState: vi.fn().mockResolvedValue({
        network: 'regtest',
        height: '0',
        hash: '00'.repeat(32),
        time: 1000,
        tree: '00',
        saplingTree: '00',
        orchardTree: '00',
        ironwoodTree: '000000',
      } as TreeState),
      getAddressUtxos: vi.fn().mockResolvedValue([]),
    } as unknown as ZcashClient;

    // 1. Initial sync with tip = 0: no blocks fetched, currentStart = 1 > 0
    const resTip0 = await syncWallet(mockClient, wallet, { verifyRootAtTip: false });
    expect(resTip0.blocksFetched).toBe(0);
    expect(requestedRanges.length).toBe(0);

    // 2. Mock wallet summary having lastScannedHeight = 15
    const summarySpy = vi.spyOn(WalletHandle.prototype, 'getWalletSummary').mockReturnValue({
      lastScannedHeight: 15,
      treeSize: 10,
      unspentNotesCount: 2,
      totalBalanceZatoshis: 500000,
      spendableBalanceZatoshis: 500000,
    });

    // Node tip is also 15 (wallet is already at tip)
    (mockClient.getInfo as any).mockResolvedValue({ blockHeight: '15' });

    requestedRanges.length = 0;
    const resAlreadyAtTip = await syncWallet(mockClient, wallet, { verifyRootAtTip: false });
    expect(resAlreadyAtTip.blocksFetched).toBe(0);
    expect(requestedRanges.length).toBe(0); // Zero requests when already at tip!

    // 3. Node advances tip to 25
    (mockClient.getInfo as any).mockResolvedValue({ blockHeight: '25' });

    requestedRanges.length = 0;
    await syncWallet(mockClient, wallet, { batchSize: 10, verifyRootAtTip: false });

    // Assert that every request range was strictly >= lastScannedHeight + 1 (16)
    expect(requestedRanges.length).toBeGreaterThan(0);
    for (const range of requestedRanges) {
      expect(range.start).toBeGreaterThanOrEqual(16);
    }
    expect(requestedRanges[0].start).toBe(16);

    summarySpy.mockRestore();
    cleanup();
  });

  it('negative test: tampered GetTreeState ironwoodTree frontier yields treeStateMatched = false', async () => {
    const { wallet, cleanup } = createTempWallet();

    const authenticFrontierHex =
      '010d3f8b26dbf85bea4ee41e5f9346fbb333b3ca3d44047dce7370dfeebc31c50001d87e82e8fbe744caa5fbdf347ba48e79d3729b338d2efe380bc8348f64928d2e1f0000015e7b3bfc0feb82f5dd24cf8a06835efaca27cc804e1ee17a26255bc3a93217270001d522396c660822eecfa4d4180d333b07d094de9834d4db082c20068586418f3501eccfc7b98746433a335efa38e87a91b06f0b4fd19e507f10d945cc5079b3862200000000000000000000000000000000000000000000000000';
    const authenticRootHex = decodeIronwoodFrontierRoot(authenticFrontierHex);

    // Mock wallet methods on prototype
    const rootSpy = vi.spyOn(WalletHandle.prototype, 'getTreeRoot').mockReturnValue(Buffer.from(authenticRootHex, 'hex'));
    const summarySpy = vi.spyOn(WalletHandle.prototype, 'getWalletSummary').mockReturnValue({
      lastScannedHeight: 10,
      treeSize: 5,
      unspentNotesCount: 1,
      totalBalanceZatoshis: 100000,
      spendableBalanceZatoshis: 100000,
    });

    // 1. Positive case: authentic frontier matches wallet root
    const mockClientMatching = {
      config: { network: 'regtest', endpoint: '127.0.0.1:28137' },
      getInfo: vi.fn().mockResolvedValue({ blockHeight: '10' }),
      getRawBlockRange: vi.fn().mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {},
      })),
      getTreeState: vi.fn().mockResolvedValue({
        network: 'regtest',
        height: '10',
        hash: '00'.repeat(32),
        time: 1000,
        tree: '00',
        saplingTree: '00',
        orchardTree: '00',
        ironwoodTree: authenticFrontierHex,
      } as TreeState),
    } as unknown as ZcashClient;

    const resPositive = await syncWallet(mockClientMatching, wallet, { verifyRootAtTip: true });
    expect(resPositive.treeStateMatched).toBe(true);

    // 2. Negative case: tampered frontier bytes
    const tamperedFrontier = authenticFrontierHex.slice(0, 20) + 'ffff' + authenticFrontierHex.slice(24);
    const mockClientTampered = {
      config: { network: 'regtest', endpoint: '127.0.0.1:28137' },
      getInfo: vi.fn().mockResolvedValue({ blockHeight: '10' }),
      getRawBlockRange: vi.fn().mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {},
      })),
      getTreeState: vi.fn().mockResolvedValue({
        network: 'regtest',
        height: '10',
        hash: '00'.repeat(32),
        time: 1000,
        tree: '00',
        saplingTree: '00',
        orchardTree: '00',
        ironwoodTree: tamperedFrontier,
      } as TreeState),
    } as unknown as ZcashClient;

    const resNegative = await syncWallet(mockClientTampered, wallet, { verifyRootAtTip: true });
    expect(resNegative.treeStateMatched).toBe(false);

    rootSpy.mockRestore();
    summarySpy.mockRestore();
    cleanup();
  });
});
