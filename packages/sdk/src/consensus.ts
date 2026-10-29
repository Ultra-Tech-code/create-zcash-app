import * as core from '@zcash-app/core';

/**
 * Known Zcash Consensus Branch IDs and their canonical Network Upgrade names.
 * Sourced from ZIP 200, ZIP 253, and zcash_protocol consensus definitions.
 */
export const CONSENSUS_BRANCH_UPGRADES: Readonly<Record<string, string>> = {
  '00000000': 'Sprout',
  '5ba81b19': 'Overwinter',
  '76b809bb': 'Sapling',
  '2bb40e60': 'Blossom',
  'f5b9230b': 'Heartwood',
  'e9ff75a6': 'Canopy',
  'c2d6d0b4': 'NU5',
  'c8e71055': 'NU6',
  '37a5165b': 'NU6.3',
  '77190ad9': 'NU7',
} as const;

/**
 * Normalizes a branch ID input (hex string, prefixed hex string, or u32 number)
 * into a standard 8-character lowercase hexadecimal string.
 */
export function normalizeBranchId(branchId: string | number | null | undefined): string {
  if (branchId === null || branchId === undefined) return '';
  if (typeof branchId === 'number') {
    return (branchId >>> 0).toString(16).padStart(8, '0').toLowerCase();
  }
  const clean = String(branchId).trim().toLowerCase().replace(/^0x/, '');
  if (!clean) return '';
  return clean.padStart(8, '0');
}

/**
 * Maps a consensus branch ID to its official network upgrade name.
 * Returns "Unknown (0x...)" if the branch ID is not recognized.
 */
export function getUpgradeName(branchId: string | number | null | undefined): string {
  const normalized = normalizeBranchId(branchId);
  if (!normalized) return 'Unknown';
  const name = CONSENSUS_BRANCH_UPGRADES[normalized];
  if (name) {
    return name;
  }
  return `Unknown (0x${normalized})`;
}

export const consensusBranchIdToUpgradeName = getUpgradeName;

/**
 * Retrieves the expected consensus branch ID for a network and block height.
 */
export function getExpectedBranchId(network: string, height: number): string {
  try {
    return core.getExpectedBranchId(network, height);
  } catch {
    return '';
  }
}
