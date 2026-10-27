import { decryptTransaction as coreDecryptTransaction } from '@zcash-app/core';
import type { DecryptedTransaction } from './types.js';

/**
 * Decrypts an Ironwood transaction wire serialization using a Unified Full Viewing Key.
 *
 * Recovers incoming actions (external and internal scope, marked with isChange/isInternal)
 * and outgoing actions (via OVK recovery). Also returns txid, net fee (valueBalance),
 * expiry height, and consensus branch ID.
 *
 * @param ufvk The Unified Full Viewing Key encoded string.
 * @param network Network name ('regtest', 'testnet', 'mainnet', 'regtest-nu7').
 * @param rawTxBytes Raw transaction serialized bytes.
 * @param height Block height of the transaction (or target height).
 * @returns Fully decrypted transaction details with typed values and decoded memos.
 */
export function decryptTransaction(
  ufvk: string,
  network: string,
  rawTxBytes: Uint8Array | Buffer,
  height: number,
): DecryptedTransaction {
  const buf = Buffer.isBuffer(rawTxBytes) ? rawTxBytes : Buffer.from(rawTxBytes);
  const res = coreDecryptTransaction(ufvk, network, buf, height);
  return {
    txid: res.txid,
    fee: res.fee !== null && res.fee !== undefined ? BigInt(res.fee) : null,
    expiryHeight: res.expiryHeight,
    consensusBranchId: res.consensusBranchId,
    incoming: res.incoming.map((inc) => ({
      actionIndex: inc.actionIndex,
      value: BigInt(inc.value),
      memo: {
        text: inc.memo.text,
        hex: inc.memo.hex,
      },
      recipient: inc.recipient,
      isChange: inc.isChange,
      isInternal: inc.isInternal,
    })),
    outgoing: res.outgoing.map((out) => ({
      actionIndex: out.actionIndex,
      value: BigInt(out.value),
      memo: {
        text: out.memo.text,
        hex: out.memo.hex,
      },
      recipient: out.recipient,
    })),
  };
}
