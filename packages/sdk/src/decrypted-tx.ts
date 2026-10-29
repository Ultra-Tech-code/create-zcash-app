import {
  decryptTransaction as coreDecryptTransaction,
  decodeTransaction as coreDecodeTransaction,
} from '@zcash-app/core';
import type { DecryptedTransaction, DecodedTransaction } from './types.js';
import { getUpgradeName } from './consensus.js';

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

/**
 * Parses and decodes raw transaction bytes locally using core crypto parsers.
 * Does not trust or rely on remote node's decoded JSON representation.
 *
 * @param rawTxBytes Serialized transaction bytes as Buffer or Uint8Array.
 * @param network Network name (optional, defaults to 'testnet').
 * @param height Confirmed block height if known (optional).
 * @returns Fully decoded transaction structure with upgrade name, pool action counts,
 *          anchors, nullifiers, commitments, and ZIP 317 fee calculation.
 */
export function decodeTransaction(
  rawTxBytes: Uint8Array | Buffer,
  network?: string,
  height?: number,
): DecodedTransaction {
  const buf = Buffer.isBuffer(rawTxBytes) ? rawTxBytes : Buffer.from(rawTxBytes);
  const res = coreDecodeTransaction(buf, network, height);
  const upgradeName = getUpgradeName(res.consensusBranchId);
  return {
    txid: res.txid,
    version: res.version,
    consensusBranchId: res.consensusBranchId,
    upgradeName,
    expiryHeight: res.expiryHeight,
    fee: res.fee !== null && res.fee !== undefined ? BigInt(res.fee) : null,
    feeUnknown: res.fee === null || res.fee === undefined,
    pools: res.pools,
    actionCounts: {
      transparentInputs: res.actionCounts.transparentInputs,
      transparentOutputs: res.actionCounts.transparentOutputs,
      saplingSpends: res.actionCounts.saplingSpends,
      saplingOutputs: res.actionCounts.saplingOutputs,
      orchardActions: res.actionCounts.orchardActions,
      ironwoodActions: res.actionCounts.ironwoodActions,
    },
    anchors: {
      sapling: res.anchors.sapling || undefined,
      orchard: res.anchors.orchard || undefined,
      ironwood: res.anchors.ironwood || undefined,
    },
    nullifiers: res.nullifiers,
    noteCommitments: res.noteCommitments,
    size: res.size,
  };
}
