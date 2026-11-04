import * as core from '@zcash-app/core';
import { Account, Network, Ufvk, WatchOnlyAccount } from './types.js';
import { KNOWN_TEST_MNEMONICS } from './constants.js';

export function generateMnemonic(): string {
  return core.generateMnemonic();
}

export function accountFromMnemonic(
  mnemonic: string,
  accountIndex: number = 0,
  network: Network = 'regtest'
): Account {
  if (network === 'mainnet') {
    const normalized = mnemonic.trim().toLowerCase();
    if (KNOWN_TEST_MNEMONICS.includes(normalized)) {
      throw new Error(
        'Security Error: Using known test fixture mnemonics on mainnet is strictly prohibited to prevent fund loss.'
      );
    }
  }

  const derived = core.deriveAccountFromMnemonic(mnemonic, accountIndex, network);

  return {
    getUnifiedAddress(diversifierIndex?: number): string {
      return core.getAddressFromUfvk(derived.ufvk, network, diversifierIndex);
    },
    getTransparentAddress(): string | undefined {
      const t = (core as any).getTransparentAddressFromUfvk(derived.ufvk, network);
      return t || undefined;
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
    getTransparentAddress(): string | undefined {
      const t = (core as any).getTransparentAddressFromUfvk(ufvk, network);
      return t || undefined;
    },
    network,
    isWatchOnly: true,
  };
}

/**
 * Returns true if the account is a watch-only account lacking spending authority.
 */
export function isWatchOnly(account: unknown): account is WatchOnlyAccount {
  if (!account || typeof account !== 'object') return false;
  if ((account as any).isWatchOnly === true) return true;
  if ('spendingKeyBytes' in account && Buffer.isBuffer((account as any).spendingKeyBytes)) return false;
  if ('spendHandle' in account && typeof (account as any).spendHandle === 'number') return false;
  return typeof (account as any).getUnifiedFullViewingKey === 'function';
}
