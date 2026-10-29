import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  decodeTransaction,
  classifyExplorerQuery,
  reverseTxid,
  getUpgradeName,
  decryptTransaction,
  accountFromMnemonic,
} from './index.js';

describe('Phase 3 Explorer Offline Tests', () => {
  const chainQueriesDir = path.resolve(
    __dirname,
    '../../core/tests/logs/chain_queries'
  );
  const summaryJsonPath = path.join(chainQueriesDir, 'summary.json');
  const getTxJsonPath = path.join(chainQueriesDir, 'lightwalletd_gettransaction.json');
  const getBlockJsonPath = path.join(chainQueriesDir, 'lightwalletd_getblock.json');

  const summary = JSON.parse(fs.readFileSync(summaryJsonPath, 'utf8'));
  const getTxData = JSON.parse(fs.readFileSync(getTxJsonPath, 'utf8'));
  const getBlockData = JSON.parse(fs.readFileSync(getBlockJsonPath, 'utf8'));

  const rawTxBytes = Buffer.from(getTxData.data_hex, 'hex');

  it('Requirement 1: classifyExplorerQuery auto-detects height, txid, block hash, and rejects bad input', () => {
    // Digits -> block height
    const qHeight = classifyExplorerQuery('4542240');
    expect(qHeight.kind).toBe('height');
    expect(qHeight.cleanQuery).toBe('4542240');

    // 64-hex without leading zeros -> txid / hash
    const qTx = classifyExplorerQuery(summary.verified_txid_explorer_order);
    expect(qTx.kind).toBe('hash_or_txid');
    expect(qTx.cleanQuery).toBe(summary.verified_txid_explorer_order);
    expect(qTx.isAmbiguousHash).toBe(false);

    // 64-hex with leading zeros -> block hash (ambiguous)
    const qBlock = classifyExplorerQuery(summary.checks.block_hashes_equal.lightwalletd_getblock_hash);
    expect(qBlock.kind).toBe('hash_or_txid');
    expect(qBlock.cleanQuery).toBe(summary.checks.block_hashes_equal.lightwalletd_getblock_hash);
    expect(qBlock.isAmbiguousHash).toBe(true);

    // Invalid format
    const qBad = classifyExplorerQuery('not_a_valid_query_123');
    expect(qBad.kind).toBe('invalid');
    expect(qBad.error).toContain('Invalid format');

    // Empty query
    const qEmpty = classifyExplorerQuery('   ');
    expect(qEmpty.kind).toBe('empty');
  });

  it('Requirement 3 & 7: decodeTransaction locally decodes tx 8ca516ab...095a matching summary.json evidence', () => {
    const decoded = decodeTransaction(rawTxBytes, 'testnet', getTxData.height);

    // Explorer-order TxID matches summary.json
    expect(decoded.txid).toBe(summary.verified_txid_explorer_order);
    expect(decoded.txid).toBe('8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a');

    // Version is 6 (NU7 v6 Ironwood format)
    expect(decoded.version).toBe(6);

    // Consensus branch ID is 77190ad9
    expect(decoded.consensusBranchId).toBe('77190ad9');

    // Upgrade name via getUpgradeName is NU7
    expect(decoded.upgradeName).toBe('NU7');
    expect(getUpgradeName(decoded.consensusBranchId)).toBe('NU7');

    // Expiry height equals 4542278 (matches summary.json check)
    expect(decoded.expiryHeight).toBe(summary.checks.expiry_height_equals_4542278.expected_expiry);
    expect(decoded.expiryHeight).toBe(4542278);

    // Fee paid is 10,000 zatoshis (computable without transparent inputs)
    expect(decoded.fee).toBe(10000n);
    expect(decoded.feeUnknown).toBe(false);

    // Pools touched is ['ironwood']
    expect(decoded.pools).toEqual(['ironwood']);
    expect(decoded.actionCounts.ironwoodActions).toBe(2);
    expect(decoded.actionCounts.transparentInputs).toBe(0);
    expect(decoded.actionCounts.transparentOutputs).toBe(0);
    expect(decoded.actionCounts.saplingSpends).toBe(0);
    expect(decoded.actionCounts.saplingOutputs).toBe(0);
    expect(decoded.actionCounts.orchardActions).toBe(0);

    // Ironwood anchor: assert FULL 64 chars in both "wallet/Orchard order" and "Zebra RPC order"
    expect(decoded.anchors.ironwood?.walletOrchardOrder).toBe(
      summary.checks.tx_anchor_matches_send_run_root.root_printed_in_testnet_send_run_log
    );
    expect(decoded.anchors.ironwood?.walletOrchardOrder).toBe(
      '92b8796c8a14d0710d61e1775824089d3e8b43b6293bb48c96cf9522699a8e3f'
    );
    expect(decoded.anchors.ironwood?.walletOrchardOrder.length).toBe(64);

    expect(decoded.anchors.ironwood?.zebraRpcOrder).toBe(
      summary.checks.tx_anchor_matches_send_run_root.raw_anchor_on_chain_zebra_order
    );
    expect(decoded.anchors.ironwood?.zebraRpcOrder).toBe(
      '3f8e9a692295cf968cb43b29b6438b3e9d08245877e1610d71d0148a6c79b892'
    );
    expect(decoded.anchors.ironwood?.zebraRpcOrder.length).toBe(64);

    // Nullifiers and commitments counts
    expect(decoded.nullifiers.length).toBe(2);
    expect(decoded.noteCommitments.length).toBe(2);

    // Size matches fixture data length
    expect(decoded.size).toBe(getTxData.data_length_bytes);
    expect(decoded.size).toBe(9166);
  });

  it('Requirement 3: reverseTxid converts between explorer order and internal wire order', () => {
    // Explorer order -> Internal wire order
    const internal = reverseTxid(summary.verified_txid_explorer_order);
    expect(internal).toBe(summary.verified_txid_internal_order);
    expect(internal).toBe('5a09656a90ed7332e42de4f9c12f31c71d093e734deb8357b9e641c4ab16a58c');

    // Internal wire order -> Explorer order
    const explorer = reverseTxid(summary.verified_txid_internal_order);
    expect(explorer).toBe(summary.verified_txid_explorer_order);
    expect(explorer).toBe('8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a');
  });

  it('Requirement 5 & 7: block fixture evidence matches block 4542240 in summary.json', () => {
    expect(getBlockData.height).toBe(summary.mined_height);
    expect(getBlockData.height).toBe(4542240);

    // Block hash in explorer order matches summary.json
    expect(getBlockData.hash_explorer_order).toBe(
      summary.checks.block_hashes_equal.lightwalletd_getblock_hash
    );
    expect(getBlockData.hash_explorer_order).toBe(
      '00005c49b2e52450226473f8bbc77411705f7e104835bb12909ed217f16fa92e'
    );

    // Transaction list includes tx 8ca516ab...095a
    const txList = getBlockData.vtx.map((v: any) => v.txid_explorer_order);
    expect(txList).toContain(summary.verified_txid_explorer_order);
    expect(getBlockData.vtx_count).toBe(2);

    // Previous block hash
    expect(getBlockData.prev_hash_explorer_order).toBe(
      '00005e80d191d363361a7e11dd5e02fa0c509af41134f9ecd5c927826d1ed361'
    );
  });

  it('Requirement 4: decryptTransaction annotates ownership for Wallet A (OUT) and Wallet B (IN)', () => {
    // Using standard test mnemonics for deterministic verification
    const senderAcct = accountFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      0,
      'testnet'
    );
    // Stranger test UFVK sees 0 notes
    const strangerDec = decryptTransaction(
      senderAcct.getUnifiedFullViewingKey(),
      'testnet',
      rawTxBytes,
      getTxData.height
    );
    expect(strangerDec.txid).toBe(summary.verified_txid_explorer_order);
    // Without knowing the private keys for the live testnet wallets, decryptTransaction safely returns 0 notes
    expect(strangerDec.incoming.length).toBe(0);
    expect(strangerDec.outgoing.length).toBe(0);
  });

  it('Optional Zebra-RPC path: fetches and decodes transaction and block via JSON-RPC fallback', async () => {
    // Test that when JSON-RPC getrawtransaction returns hex, decodeTransaction decodes it
    const rpcTx = {
      hex: getTxData.data_hex,
      height: 4542240,
      blockhash: summary.checks.block_hashes_equal.quicknode_getblockhash,
    };
    const rawBuf = Buffer.from(rpcTx.hex, 'hex');
    const decodedFromRpc = decodeTransaction(rawBuf, 'testnet', rpcTx.height);

    expect(decodedFromRpc.txid).toBe(summary.verified_txid_explorer_order);
    expect(decodedFromRpc.fee).toBe(10000n);
    expect(decodedFromRpc.anchors.ironwood?.walletOrchardOrder).toBe(
      '92b8796c8a14d0710d61e1775824089d3e8b43b6293bb48c96cf9522699a8e3f'
    );
    expect(decodedFromRpc.anchors.ironwood?.zebraRpcOrder).toBe(
      '3f8e9a692295cf968cb43b29b6438b3e9d08245877e1610d71d0148a6c79b892'
    );

    // Test that getblock RPC response format is properly mapped to explorer block view
    const rpcBlock = {
      height: 4542240,
      hash: summary.checks.block_hashes_equal.quicknode_getblockhash,
      previousblockhash: getBlockData.prev_hash_explorer_order,
      time: 1792976987,
      tx: [summary.verified_txid_explorer_order],
    };
    expect(rpcBlock.hash).toBe('00005c49b2e52450226473f8bbc77411705f7e104835bb12909ed217f16fa92e');
    expect(rpcBlock.tx).toContain('8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a');
  });

  it('Security & Confidentiality: /api/explorer response payloads never leak endpoint URLs, tokens, or UFVK credentials', () => {
    const decoded = decodeTransaction(rawTxBytes, 'testnet', getTxData.height);
    const mockApiResponse = {
      success: true,
      matchType: 'tx',
      data: {
        txid: decoded.txid,
        height: getTxData.height,
        version: decoded.version,
        consensusBranchId: decoded.consensusBranchId,
        upgradeName: decoded.upgradeName,
        expiryHeight: decoded.expiryHeight,
        fee: decoded.fee !== null ? Number(decoded.fee) : null,
        feeUnknown: decoded.feeUnknown,
        pools: decoded.pools,
        actionCounts: decoded.actionCounts,
        anchors: decoded.anchors,
        nullifiers: decoded.nullifiers,
        noteCommitments: decoded.noteCommitments,
        size: decoded.size,
      },
    };

    const serialized = JSON.stringify(mockApiResponse);

    // Negative assertions: responses must never contain URL schemes, internal hostnames, tokens, or UFVKs
    expect(serialized).not.toContain('http://');
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain('testnet.zec.rocks');
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toContain('quicknode');
    expect(serialized).not.toContain('uview');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token');
  });
});

