import { describe, it, expect, vi } from 'vitest';
import { getBalance } from './detection.js';
import { Account, ZcashClient } from './index.js';

describe('Spend Tracking & Balance Calculation', () => {
  it('deducts spent notes when their nullifiers appear in spentNullifiers', async () => {
    const fakeNullifier = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    // Mock ZcashClient with two blocks:
    // Block 10: receives an Orchard note with value 500,000 zatoshis and fakeNullifier
    // Block 12: has a transaction whose actions spend fakeNullifier
    const mockBlocks = [
      {
        height: 10,
        vtx: [
          {
            hash: Buffer.from('tx1_receive'),
            actions: [
              {
                nullifier: Buffer.alloc(32, 0),
                cmx: Buffer.alloc(32, 1),
                ephemeralKey: Buffer.alloc(32, 2),
                ciphertext: Buffer.alloc(52, 3),
              },
            ],
          },
        ],
      },
      {
        height: 12,
        vtx: [
          {
            hash: Buffer.from('tx2_spend'),
            actions: [
              {
                nullifier: Buffer.from(fakeNullifier, 'hex'),
                cmx: Buffer.alloc(32, 4),
                ephemeralKey: Buffer.alloc(32, 5),
                ciphertext: Buffer.alloc(52, 6),
              },
            ],
          },
        ],
      },
    ];

    const mockClient = {
      config: { network: 'regtest', endpoint: '127.0.0.1:28137' },
      getInfo: vi.fn().mockResolvedValue({ blockHeight: '15' }),
      getBlockRange: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const b of mockBlocks) {
            yield b;
          }
        },
      }),
      getAddressUtxos: vi.fn().mockResolvedValue([]),
    } as unknown as ZcashClient;

    const mockAccount: Account = {
      getUnifiedAddress: () => 'uregtest1...',
      getUnifiedFullViewingKey: () => 'uviewregtest1...',
      network: 'regtest',
      spendHandle: 1,
      birthdayHeight: 1,
    };

    // Case A: With the spend in Block 12, the balance should be 0n
    // Mock core.tryDecryptAction to return our note for Block 10
    const core = await import('@zcash-app/core');
    const spy = vi.spyOn(core, 'tryDecryptAction').mockImplementation((_ufvk, _net, _epk, _cmx, _ct, _isIronwood, idx) => {
      if (idx === 0) {
        return {
          pool: 'orchard',
          valueZatoshis: 500_000,
          recipient: 'uregtest1...',
          actionIndex: 0,
          nullifier: fakeNullifier,
          rho: '04'.repeat(32),
          rseed: '05'.repeat(32),
        };
      }
      return null;
    });

    const balanceSpent = await getBalance(mockClient, mockAccount);
    expect(balanceSpent.orchard).toBe(0n);
    expect(balanceSpent.total).toBe(0n);

    // Case B: If block 12 spend did not occur, balance is 500_000n
    mockBlocks.pop(); // remove spending block
    const balanceUnspent = await getBalance(mockClient, mockAccount);
    expect(balanceUnspent.orchard).toBe(500000n);
    expect(balanceUnspent.total).toBe(500000n);

    spy.mockRestore();
  });

  it('splits confirmed and pending balances according to minConf', async () => {
    const note1Nf = '1111111111111111111111111111111111111111111111111111111111111111';
    const note2Nf = '2222222222222222222222222222222222222222222222222222222222222222';

    const mockBlocks = [
      {
        height: 18, // 3 confirmations at tip 20 (20 - 18 + 1 = 3)
        vtx: [
          {
            hash: Buffer.from('tx_mature'),
            ironwoodActions: [
              {
                nullifier: Buffer.alloc(32, 0),
                cmx: Buffer.alloc(32, 1),
                ephemeralKey: Buffer.alloc(32, 2),
                ciphertext: Buffer.alloc(52, 3),
              },
            ],
          },
        ],
      },
      {
        height: 20, // 1 confirmation at tip 20 (20 - 20 + 1 = 1)
        vtx: [
          {
            hash: Buffer.from('tx_recent'),
            ironwoodActions: [
              {
                nullifier: Buffer.alloc(32, 0),
                cmx: Buffer.alloc(32, 1),
                ephemeralKey: Buffer.alloc(32, 2),
                ciphertext: Buffer.alloc(52, 3),
              },
            ],
          },
        ],
      },
    ];

    const mockClient = {
      config: { network: 'regtest', endpoint: '127.0.0.1:28137' },
      getInfo: vi.fn().mockResolvedValue({ blockHeight: '20' }),
      getBlockRange: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const b of mockBlocks) {
            yield b;
          }
        },
      }),
      getAddressUtxos: vi.fn().mockResolvedValue([]),
    } as unknown as ZcashClient;

    const mockAccount: Account = {
      getUnifiedAddress: () => 'uregtest1...',
      getUnifiedFullViewingKey: () => 'uviewregtest1...',
      network: 'regtest',
      spendHandle: 0,
    };

    const core = await import('@zcash-app/core');
    const spy = vi.spyOn(core, 'tryDecryptAction').mockImplementation((_ufvk, _net, _epk, _cmx, _ct, _isIronwood, idx) => {
      // Return 100 zatoshis for height 18 and 200 zatoshis for height 20
      return {
        pool: 'ironwood',
        valueZatoshis: 100_000,
        recipient: 'uregtest1...',
        actionIndex: idx,
        nullifier: note1Nf,
        rho: '04'.repeat(32),
        rseed: '05'.repeat(32),
      };
    });

    // Default minConf = 1: both notes (height 18 with 3 confs, height 20 with 1 conf) are confirmed
    const resDefault = await getBalance(mockClient, mockAccount);
    expect(resDefault.confirmed.ironwood).toBe(200_000n);
    expect(resDefault.pending.ironwood).toBe(0n);
    expect(resDefault.total).toBe(200_000n);

    // With minConf = 2: height 20 (1 conf) is pending, height 18 (3 confs) is confirmed
    const resMinConf2 = await getBalance(mockClient, mockAccount, { minConf: 2 });
    expect(resMinConf2.confirmed.ironwood).toBe(100_000n);
    expect(resMinConf2.pending.ironwood).toBe(100_000n);
    expect(resMinConf2.total).toBe(100_000n);

    spy.mockRestore();
  });
});
