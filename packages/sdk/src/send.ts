import crypto from 'crypto';
import {
  WalletHandle,
  JsSpendableNote,
  JsBuildTransactionRequest,
  JsBuiltTransaction,
  quoteFee as coreQuoteFee,
  warmupProver as coreWarmupProver,
  decodeIronwoodFrontierRoot,
  ironwoodEmptyTreeRoot,
  getExpectedBranchId,
  getDefaultTxExpiryDelta,
} from '@zcash-app/core';
import { ZcashClient, TreeState } from './client.js';
import { syncWallet } from './sync.js';
import { Account, VerificationEndpoint } from './types.js';
import { JsonRpcVerifier } from './jsonrpc.js';

export interface SendFromOptions {
  spendHandle?: number;
  spendingKeyBytes?: Buffer;
}

export interface SendOptions {
  client: ZcashClient;
  wallet: WalletHandle;
  from?: SendFromOptions | Account | number;
  to: string;
  amount: bigint | number;
  memo?: string;
  minConfs?: number;
  anchorHeight?: number;
  /**
   * Dev/offline escape hatch. When the node's Ironwood frontier cannot be fetched or decoded,
   * a send is refused by default because the anchor cannot be verified against consensus.
   * Set this to true to send with only the local anchor root (a warning is logged).
   */
  allowUnverifiedAnchor?: boolean;
}

/** Thrown when the anchor cannot be checked against the node and no explicit override was given. */
export class AnchorVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnchorVerificationError';
  }
}

/** Thrown when the node's consensus branch does not match the crate's derived consensus branch. */
export class ConsensusBranchMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsensusBranchMismatchError';
  }
}

/** Thrown when transaction building is attempted within one block before a network upgrade activation. */
export class UpgradeBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpgradeBoundaryError';
  }
}

/**
 * Converts a 32-byte hex transaction ID between internal byte order and node/explorer display order (byte-reversed).
 */
export function reverseTxid(hexTxid: string): string {
  const cleanHex = hexTxid.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanHex)) {
    throw new Error(`Invalid transaction ID hex string: expected 64 hex characters, got "${hexTxid}"`);
  }
  return Buffer.from(cleanHex, 'hex').reverse().toString('hex');
}

export interface SendResult {
  txid: string;
  fee: bigint;
  rawBytes: Buffer;
  numActions: number;
  expiryHeight: number;
}

/**
 * Returns the standard ZIP 317 fee for a transaction with the given number of actions.
 */
export function quoteFee(numActions: number): bigint {
  return BigInt(coreQuoteFee(numActions));
}

/**
 * Warms up the static circuit proving key in a background thread ahead of first send.
 */
export function warmupProver(): void {
  coreWarmupProver();
}

/**
 * High-level atomic transaction send pipeline:
 * 1. Checks tip & syncs wallet if needed.
 * 2. Selects an anchor height (tip - 5, min 2) and verifies tree root against getTreeState.
 * 3. Queries spendable notes and calculates ZIP-317 fee.
 * 4. Places an in-flight reservation on selected notes.
 * 5. Builds and Halo2-proves the V6 Ironwood transaction asynchronously.
 * 6. Broadcasts raw transaction to network via lightd client.
 * 7. Marks reservation as broadcast.
 * If building, proving, or broadcast fails, the reservation is canceled immediately.
 */
export async function send(opts: SendOptions): Promise<SendResult> {
  const { client, wallet, to, amount: rawAmount, memo } = opts;
  const amount = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  const minConfs = opts.minConfs ?? 1;

  // Resolve spend handle or spending key
  let spendHandle: number | undefined;
  let spendingKeyBytes: Buffer | undefined;

  if (typeof opts.from === 'number') {
    spendHandle = opts.from;
  } else if (opts.from && typeof opts.from === 'object') {
    if ('spendHandle' in opts.from && typeof opts.from.spendHandle === 'number') {
      spendHandle = opts.from.spendHandle;
    }
    if ('spendingKeyBytes' in opts.from && Buffer.isBuffer(opts.from.spendingKeyBytes)) {
      spendingKeyBytes = opts.from.spendingKeyBytes;
    }
  }

  if (spendHandle === undefined && spendingKeyBytes === undefined) {
    spendHandle = 0;
  }

  // 1. Check tip and assert consensus branch matches node (fail closed on all networks)
  const info = await client.getInfo();
  const tipHeight = Number(info.blockHeight);
  const targetHeight = tipHeight + 1;

  const tipBranchId = getExpectedBranchId(client.config.network, tipHeight).toLowerCase().replace(/^0x/, '');
  const targetBranchId = getExpectedBranchId(client.config.network, targetHeight).toLowerCase().replace(/^0x/, '');

  if (tipBranchId !== targetBranchId) {
    throw new UpgradeBoundaryError(
      `Cannot build transaction: tip height ${tipHeight} is within one block of network upgrade activation at height ${targetHeight}. Transaction building is refused at upgrade boundaries.`
    );
  }

  const nodeBranchId = (info.consensusBranchId ?? '').toLowerCase().replace(/^0x/, '');
  if (!nodeBranchId || nodeBranchId !== tipBranchId) {
    throw new ConsensusBranchMismatchError(
      `Consensus branch mismatch on network ${client.config.network} at height ${tipHeight}: local expected 0x${tipBranchId}, node reported 0x${info.consensusBranchId ?? 'none'}`
    );
  }

  const summary = wallet.getWalletSummary();
  if (summary.lastScannedHeight < tipHeight) {
    await syncWallet(client, wallet);
  }

  // 2. Determine anchor height
  let anchorHeight = opts.anchorHeight;
  if (!anchorHeight) {
    const tipNotes = wallet.querySpendableNotes(tipHeight, minConfs);
    if (tipNotes.length === 0) {
      throw new Error(
        `Insufficient funds: spendable notes total 0 zatoshis < amount ${amount}`
      );
    }
    const maxNoteHeight = Math.max(...tipNotes.map((n) => n.height));
    if (tipHeight >= 7 && maxNoteHeight <= tipHeight - 5) {
      anchorHeight = tipHeight - 5;
    } else {
      anchorHeight = tipHeight;
    }
  }

  // Verify local root against the node's Ironwood frontier. Fails closed: a send is refused
  // unless the anchor was actually checked, or the caller explicitly opted out for dev.
  const localRootBuf = wallet.getTreeRootAtHeight(anchorHeight);
  if (!localRootBuf) {
    throw new Error(`No commitment tree checkpoint found at anchor height ${anchorHeight}`);
  }
  const localRootHex = localRootBuf.toString('hex');
  const allowUnverifiedAnchor = opts.allowUnverifiedAnchor === true;
  if (allowUnverifiedAnchor && client.config.network !== 'regtest') {
    throw new AnchorVerificationError(
      `allowUnverifiedAnchor is strictly forbidden on ${client.config.network}. Anchors must be verified against consensus.`
    );
  }

  let treeState: TreeState | undefined;
  try {
    treeState = await client.getTreeState(anchorHeight);
  } catch (err: any) {
    const reason = err?.message ?? String(err);
    if (!allowUnverifiedAnchor) {
      throw new AnchorVerificationError(
        `Cannot verify anchor against node at height ${anchorHeight}: getTreeState failed (${reason})`
      );
    }
    console.warn(
      `[send] WARNING: anchor ${anchorHeight} was NOT verified against the node (getTreeState failed: ${reason}); proceeding because allowUnverifiedAnchor=true`
    );
  }

  if (treeState) {
    const nodeTreeHex = (treeState.ironwoodTree ?? '').toLowerCase();
    let remoteRootHex: string | null = null;

    if (/^0*$/.test(nodeTreeHex)) {
      // Empty-tree marker: the node has no Ironwood commitments at this height, so the anchor it
      // reports is the empty Ironwood root. Compare against it instead of skipping the check —
      // a wallet that does have commitments here must not pass against an empty node tree.
      remoteRootHex = ironwoodEmptyTreeRoot().toLowerCase();
    } else {
      try {
        remoteRootHex = decodeIronwoodFrontierRoot(treeState.ironwoodTree);
      } catch (err: any) {
        const reason = err?.message ?? String(err);
        if (!allowUnverifiedAnchor) {
          throw new AnchorVerificationError(
            `Cannot verify anchor against node at height ${anchorHeight}: undecodable Ironwood frontier (${reason})`
          );
        }
        console.warn(
          `[send] WARNING: anchor ${anchorHeight} was NOT verified against the node (undecodable Ironwood frontier: ${reason}); proceeding because allowUnverifiedAnchor=true`
        );
      }
    }

    if (remoteRootHex !== null && localRootHex !== remoteRootHex.toLowerCase()) {
      throw new AnchorVerificationError(
        `Tree root mismatch at anchor height ${anchorHeight}: local ${localRootHex} != remote ${remoteRootHex}`
      );
    }
  }

  // Cross-check anchor against secondary verification endpoints if configured
  const verifyEndpoints = client.config.verifyEndpoints ?? [];
  const endpointLabel = client.safeEndpoint ?? client.config.endpoint;
  if (verifyEndpoints.length === 0) {
    console.log(
      `[send] (${endpointLabel}) (third-party server) Anchor verification is single-source. No secondary verification endpoints configured.`
    );
  } else {
    for (const ep of verifyEndpoints) {
      let secondaryRootHex: string | null = null;
      let epLabel = '';
      if (typeof ep === 'string' || ep.kind === 'grpc') {
        const epUrl = typeof ep === 'string' ? ep : ep.url;
        epLabel = `[${epUrl}] (third-party server)`;
        const secClient = new ZcashClient({ endpoint: epUrl, network: client.config.network });
        try {
          const secTreeState = await secClient.getTreeState(anchorHeight);
          if (secTreeState.ironwoodTree && !/^0*$/.test(secTreeState.ironwoodTree)) {
            secondaryRootHex = decodeIronwoodFrontierRoot(secTreeState.ironwoodTree);
          } else {
            secondaryRootHex = ironwoodEmptyTreeRoot().toLowerCase();
          }
        } finally {
          await secClient.close();
        }
      } else if (ep.kind === 'jsonrpc') {
        const jsonVerifier = new JsonRpcVerifier(ep.url);
        epLabel = `[${jsonVerifier.safeUrl}] (third-party server)`;
        const secTreeState = await jsonVerifier.getTreeState(anchorHeight);
        const finalRoot = secTreeState.ironwood?.commitments?.finalRoot;
        if (finalRoot) {
          secondaryRootHex = finalRoot.toLowerCase();
        } else {
          secondaryRootHex = ironwoodEmptyTreeRoot().toLowerCase();
        }
      }

      if (secondaryRootHex && secondaryRootHex.toLowerCase() !== localRootHex.toLowerCase()) {
        throw new AnchorVerificationError(
          `Secondary endpoint cross-check mismatch at anchor height ${anchorHeight}: primary/local ${localRootHex} != secondary ${epLabel} ${secondaryRootHex}`
        );
      }
      console.log(
        `[send] Cross-verified anchor root ${localRootHex} against secondary endpoint ${epLabel} at height ${anchorHeight} ✅`
      );
    }
  }

  // 3. Query spendable notes and compute ZIP-317 fee
  const spendableNotes = wallet.querySpendableNotes(anchorHeight, minConfs);
  const selectedNotes: JsSpendableNote[] = [];
  let selectedTotal = 0n;
  let estimatedActions = 2; // standard 1 spend, 2 outputs (recipient + change)
  let requiredFee = quoteFee(estimatedActions);

  for (const note of spendableNotes) {
    selectedNotes.push(note);
    selectedTotal += BigInt(note.valueZatoshis);
    estimatedActions = Math.max(selectedNotes.length, 2);
    requiredFee = quoteFee(estimatedActions);

    if (selectedTotal >= amount + requiredFee) {
      break;
    }
  }

  if (selectedTotal < amount + requiredFee) {
    throw new Error(
      `Insufficient funds: spendable notes total ${selectedTotal} zatoshis < amount ${amount} + fee ${requiredFee}`
    );
  }

  // 4. In-flight reservation
  const reservationId = crypto.randomBytes(32);
  const network = client.config?.network || 'regtest';
  const expiryDelta = getDefaultTxExpiryDelta(network, targetHeight);
  const expiryHeight = tipHeight + expiryDelta;
  const selectedNoteIds = selectedNotes.map((n) => n.id);

  try {
    wallet.reserveNotes(selectedNoteIds, reservationId, expiryHeight);
  } catch (err: any) {
    if (err.message && err.message.includes('already reserved')) {
      throw new Error(`Insufficient funds: note was reserved by a concurrent transaction`);
    }
    throw err;
  }

  // 5. Build and prove transaction asynchronously
  let built: JsBuiltTransaction;
  try {
    const buildReq: JsBuildTransactionRequest = {
      spendHandle,
      spendingKeyBytes,
      recipientAddress: to,
      amountZatoshis: Number(amount),
      memo,
      anchorBytes: localRootBuf,
      anchorHeight,
      expiryHeight,
      spendableNoteIds: selectedNoteIds,
      reservationId,
    };

    built = (await wallet.buildAndProveTransaction(buildReq)) as JsBuiltTransaction;
  } catch (buildErr) {
    // Release reservation on failure
    try {
      wallet.cancelReservation(reservationId);
    } catch (_) {}
    throw buildErr;
  }

  // 6. Broadcast transaction
  try {
    const sendRes = await client.sendTransaction(built.rawBytes);
    if (sendRes.errorCode !== 0) {
      wallet.cancelReservation(reservationId);
      throw new Error(`Transaction broadcast failed (${sendRes.errorCode}): ${sendRes.errorMessage}`);
    }
  } catch (broadcastErr) {
    try {
      wallet.cancelReservation(reservationId);
    } catch (_) {}
    throw broadcastErr;
  }

  // 7. Mark as broadcast
  const txidBuf = Buffer.from(built.txid, 'hex');
  wallet.markBroadcastWithReservation(txidBuf, reservationId);

  return {
    txid: built.txid,
    fee: BigInt(built.fee),
    rawBytes: built.rawBytes,
    numActions: built.numActions,
    expiryHeight: built.expiryHeight,
  };
}
