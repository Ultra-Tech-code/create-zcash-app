import * as core from '@zcash-app/core';
import { Account, Network, Ufvk, WatchOnlyAccount } from './types.js';

export function generateMnemonic(): string {
  return core.generateMnemonic();
}

export function accountFromMnemonic(
  mnemonic: string,
  accountIndex: number = 0,
  network: Network = 'regtest'
): Account {
  const derived = core.deriveAccountFromMnemonic(mnemonic, accountIndex, network);

  return {
    getUnifiedAddress(diversifierIndex?: number): string {
      return core.getAddressFromUfvk(derived.ufvk, network, diversifierIndex);
    },
    getUnifiedFullViewingKey(): Ufvk {
      return derived.ufvk;
    },
    network,
    spendHandle: derived.spendHandle,
  };
}

export function accountFromUfvk(
  ufvk: Ufvk,
  network: Network = 'regtest'
): WatchOnlyAccount {
  return {
    getUnifiedFullViewingKey(): Ufvk {
      return ufvk;
    },
    getUnifiedAddress(diversifierIndex?: number): string {
      return core.getAddressFromUfvk(ufvk, network, diversifierIndex);
    },
    network,
  };
}
