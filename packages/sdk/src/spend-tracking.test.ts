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
      config: { network: 'regtest', endpoint: '127.0.0.1:8137' },
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
});
