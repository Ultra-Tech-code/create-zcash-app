import * as core from '@zcash-app/core';
import { ZcashClient } from './client.js';
import { Account, AccountBalance, IncomingNote, PoolBalances, SyncResult, Ufvk, WatchOnlyAccount } from './types.js';

export async function detectIncoming(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number; endHeight?: number }
): Promise<{ notes: IncomingNote[]; spentNullifiers: Set<string> }> {
  const ufvk = typeof key === 'string' ? key : key.getUnifiedFullViewingKey();
  const network = client.config.network;

  const info = await client.getInfo();
  const currentHeight = parseInt(info.blockHeight, 10);
  const targetEndHeight = opts?.endHeight ?? currentHeight;

  let startHeight = opts?.sinceHeight;
  if (startHeight === undefined) {
    const acctBirthday = typeof key !== 'string' ? key.birthdayHeight : undefined;
    startHeight = acctBirthday ?? 1;
  }

  if (startHeight > targetEndHeight) {
    return { notes: [], spentNullifiers: new Set() };
  }

  const detected: IncomingNote[] = [];
  const spentNullifiers = new Set<string>();

  const blockStream = client.getBlockRange(startHeight, targetEndHeight);

  let orchardTreePosition = 0;
  let ironwoodTreePosition = 0;

  for await (const block of blockStream) {
    const blockHeight = typeof block.height === 'string' ? parseInt(block.height, 10) : Number(block.height);
    if (!block.vtx) continue;

    for (const tx of block.vtx) {
      const rawTxid = (tx as any).txid ?? tx.hash;
      const txid = Buffer.isBuffer(rawTxid)
        ? Buffer.from(rawTxid).reverse().toString('hex')
        : String(rawTxid ?? '');

      // Record any spent nullifiers in actions
      if (tx.actions && tx.actions.length > 0) {
        for (let i = 0; i < tx.actions.length; i++) {
          const action = tx.actions[i];
          const hasCmx = action.cmx && action.cmx.length === 32;
          const currentPos = hasCmx ? orchardTreePosition++ : undefined;

          if (action.nullifier && action.nullifier.length === 32) {
            const nfHex = Buffer.from(action.nullifier).toString('hex');
            spentNullifiers.add(nfHex);
          }

          // In protobuf keepCase: true, field is ciphertext
          const encCiphertext = action.ciphertext || action.cipherText;
          if (!encCiphertext) continue;

          const result = core.tryDecryptAction(
            ufvk,
            network,
            action.ephemeralKey,
            action.cmx,
            encCiphertext,
            false,
            i,
            action.nullifier
          );
          if (result) {
            detected.push({
              pool: 'orchard',
              value: BigInt(result.valueZatoshis),
              txid,
              height: blockHeight,
              recipient: result.recipient,
              nullifier: result.nullifier,
              rho: result.rho,
              rseed: result.rseed,
              cmx: hasCmx ? Buffer.from(action.cmx).toString('hex') : undefined,
              treePosition: currentPos,
            });
          }
        }
      }

      // Record any spent nullifiers in ironwoodActions
      if (tx.ironwoodActions && tx.ironwoodActions.length > 0) {
        for (let i = 0; i < tx.ironwoodActions.length; i++) {
          const action = tx.ironwoodActions[i];
          const hasCmx = action.cmx && action.cmx.length === 32;
          const currentPos = hasCmx ? ironwoodTreePosition++ : undefined;

          if (action.nullifier && action.nullifier.length === 32) {
            const nfHex = Buffer.from(action.nullifier).toString('hex');
            spentNullifiers.add(nfHex);
          }

          const encCiphertext = action.ciphertext || action.cipherText;
          if (!encCiphertext) continue;

          const result = core.tryDecryptAction(
            ufvk,
            network,
            action.ephemeralKey,
            action.cmx,
            encCiphertext,
            true,
            i,
            action.nullifier
          );
          if (result) {
            detected.push({
              pool: 'ironwood',
              value: BigInt(result.valueZatoshis),
              txid,
              height: blockHeight,
              recipient: result.recipient,
              nullifier: result.nullifier,
              rho: result.rho,
              rseed: result.rseed,
              cmx: hasCmx ? Buffer.from(action.cmx).toString('hex') : undefined,
              treePosition: currentPos,
            });
          }
        }
      }
    }
  }

  return { notes: detected, spentNullifiers };
}

export async function getBalance(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { minConf?: number; sinceHeight?: number; endHeight?: number }
): Promise<AccountBalance> {
  const minConf = opts?.minConf ?? 1;
  const info = await client.getInfo();
  const currentHeight = parseInt(info.blockHeight, 10);

  const { notes, spentNullifiers } = await detectIncoming(client, key, opts);

  const confirmed: PoolBalances = {
    orchard: 0n,
    ironwood: 0n,
    sapling: 0n,
    transparent: 0n,
    total: 0n,
  };

  const pending: PoolBalances = {
    orchard: 0n,
    ironwood: 0n,
    sapling: 0n,
    transparent: 0n,
    total: 0n,
  };

  for (const n of notes) {
    if (n.nullifier && spentNullifiers.has(n.nullifier)) {
      continue;
    }

    const confs = currentHeight >= n.height ? currentHeight - n.height + 1 : 0;
    const target = confs >= minConf ? confirmed : pending;

    if (n.pool === 'orchard') {
      target.orchard += n.value;
    } else if (n.pool === 'ironwood') {
      target.ironwood += n.value;
    }
  }

  let transparentConfirmed = 0n;
  let transparentPending = 0n;
  const tAddr = typeof key !== 'string' && key.getTransparentAddress ? key.getTransparentAddress() : undefined;
  if (tAddr) {
    try {
      const utxos = await client.getAddressUtxos([tAddr]);
      for (const u of utxos) {
        if (u.valueZat) {
          const uHeight = u.height ? Number(u.height) : 0;
          const confs = uHeight > 0 && currentHeight >= uHeight ? currentHeight - uHeight + 1 : 0;
          if (confs >= minConf) {
            transparentConfirmed += BigInt(u.valueZat);
          } else {
            transparentPending += BigInt(u.valueZat);
          }
        }
      }
    } catch (e) {
      // transparent index not available or empty
    }
  }

  confirmed.transparent = transparentConfirmed;
  pending.transparent = transparentPending;

  confirmed.total = confirmed.orchard + confirmed.ironwood + confirmed.sapling + confirmed.transparent;
  pending.total = pending.orchard + pending.ironwood + pending.sapling + pending.transparent;

  return {
    orchard: confirmed.orchard,
    ironwood: confirmed.ironwood,
    sapling: confirmed.sapling,
    transparent: confirmed.transparent,
    total: confirmed.total,
    confirmed,
    pending,
  };
}

export async function sync(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number }
): Promise<SyncResult> {
  const info = await client.getInfo();
  const currentHeight = parseInt(info.blockHeight, 10);
  const { notes } = await detectIncoming(client, key, opts);
  const balances = await getBalance(client, key);

  return {
    syncedHeight: currentHeight,
    newNotes: notes,
    balances,
  };
}

export function watch(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  onNote: (note: IncomingNote) => void,
  opts?: { pollMs?: number }
): () => void {
  const pollInterval = opts?.pollMs ?? 15000;
  let active = true;
  let lastScannedHeight = 0;

  const poll = async () => {
    if (!active) return;
    try {
      const info = await client.getInfo();
      const currentHeight = parseInt(info.blockHeight, 10);

      if (lastScannedHeight === 0) {
        // First run: establish tip without re-emitting history unless birthdayHeight is set
        const birthday = typeof key !== 'string' ? key.birthdayHeight : undefined;
        lastScannedHeight = birthday ? birthday - 1 : currentHeight;
      }

      if (currentHeight > lastScannedHeight) {
        const nextStart = lastScannedHeight + 1;
        const { notes } = await detectIncoming(client, key, {
          sinceHeight: nextStart,
          endHeight: currentHeight,
        });

        for (const note of notes) {
          onNote(note);
        }
        lastScannedHeight = currentHeight;
      }
    } catch (err) {
      // transient network poll error
    }

    if (active) {
      setTimeout(poll, pollInterval);
    }
  };

  poll();

  return () => {
    active = false;
  };
}
