import * as core from '@zcash-app/core';
import { ZcashClient } from './client.js';
import { Account, IncomingNote, PoolBalances, SyncResult, Ufvk, WatchOnlyAccount } from './types.js';

export async function detectIncoming(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number }
): Promise<IncomingNote[]> {
  const ufvk = typeof key === 'string' ? key : key.getUnifiedFullViewingKey();
  const network = client.config.network;

  const info = await client.getInfo();
  const currentHeight = parseInt(info.blockHeight, 10);
  const startHeight = opts?.sinceHeight ?? Math.max(1, currentHeight - 100);

  const detected: IncomingNote[] = [];

  const blockStream = client.getBlockRange(startHeight, currentHeight);

  for await (const block of blockStream) {
    const blockHeight = typeof block.height === 'string' ? parseInt(block.height, 10) : block.height;
    if (!block.vtx) continue;

    for (const tx of block.vtx) {
      const txid = Buffer.isBuffer(tx.hash) ? tx.hash.toString('hex') : String(tx.hash);

      // 1. Scan Orchard actions
      if (tx.actions && tx.actions.length > 0) {
        for (let i = 0; i < tx.actions.length; i++) {
          const action = tx.actions[i];
          const result = core.tryDecryptAction(
            ufvk,
            network,
            action.ephemeralKey,
            action.cmx,
            action.cipherText,
            false,
            i
          );
          if (result) {
            detected.push({
              pool: 'orchard',
              value: BigInt(result.valueZatoshis),
              txid,
              height: blockHeight,
              recipient: result.recipient,
            });
          }
        }
      }

      // 2. Scan Ironwood actions
      if (tx.ironwoodActions && tx.ironwoodActions.length > 0) {
        for (let i = 0; i < tx.ironwoodActions.length; i++) {
          const action = tx.ironwoodActions[i];
          const result = core.tryDecryptAction(
            ufvk,
            network,
            action.ephemeralKey,
            action.cmx,
            action.cipherText,
            true,
            i
          );
          if (result) {
            detected.push({
              pool: 'ironwood',
              value: BigInt(result.valueZatoshis),
              txid,
              height: blockHeight,
              recipient: result.recipient,
            });
          }
        }
      }
    }
  }

  return detected;
}

export async function getBalance(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account
): Promise<PoolBalances> {
  const notes = await detectIncoming(client, key);

  let orchard = 0n;
  let ironwood = 0n;

  for (const n of notes) {
    if (n.pool === 'orchard') {
      orchard += n.value;
    } else if (n.pool === 'ironwood') {
      ironwood += n.value;
    }
  }

  let transparent = 0n;
  const tAddr = typeof key !== 'string' && key.getTransparentAddress ? key.getTransparentAddress() : undefined;
  if (tAddr) {
    try {
      const utxos = await client.getAddressUtxos([tAddr]);
      for (const u of utxos) {
        if (u.valueZat) {
          transparent += BigInt(u.valueZat);
        }
      }
    } catch (e) {
      // transparent index not available or empty
    }
  }

  return {
    orchard,
    ironwood,
    sapling: 0n,
    transparent,
    total: orchard + ironwood + transparent,
  };
}

export async function sync(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number }
): Promise<SyncResult> {
  const info = await client.getInfo();
  const currentHeight = parseInt(info.blockHeight, 10);
  const notes = await detectIncoming(client, key, opts);
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
  let lastHeight = 0;

  const poll = async () => {
    if (!active) return;
    try {
      const notes = await detectIncoming(client, key, { sinceHeight: lastHeight > 0 ? lastHeight : undefined });
      for (const note of notes) {
        if (note.height > lastHeight) {
          lastHeight = note.height;
        }
        onNote(note);
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
