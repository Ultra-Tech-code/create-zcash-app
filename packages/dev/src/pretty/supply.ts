/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import {
  createColors,
  formatZatoshis,
  formatZec,
  padLeft,
  padRight,
  shouldColor,
  toZatoshis,
} from './format';
import { BlockchainInfo, FormatOptions, ValuePool } from './types';

export const KNOWN_POOLS = [
  'transparent',
  'sprout',
  'sapling',
  'orchard',
  'lockbox',
  'ironwood',
] as const;

export const SHIELDED_POOLS = new Set([
  'sprout',
  'sapling',
  'orchard',
  'ironwood',
]);

export interface ParsedPool {
  id: string;
  name: string;
  chainValueZat: bigint;
  monitored: boolean;
}

export function parseSupplyInfo(bci: BlockchainInfo): {
  chain: string;
  tipHeight: number | string;
  totalChainSupplyZat: bigint;
  totalShieldedSupplyZat: bigint;
  pools: ParsedPool[];
} {
  const rawPools: ValuePool[] = bci.valuePools || [];
  const poolMap = new Map<string, ValuePool>();
  for (const p of rawPools) {
    if (p && p.id) {
      poolMap.set(p.id.toLowerCase(), p);
    }
  }

  const seenIds = new Set<string>();
  const parsedPools: ParsedPool[] = [];

  // 1. Process known standard pools in consistent order
  for (const id of KNOWN_POOLS) {
    seenIds.add(id);
    const raw = poolMap.get(id);
    const chainValueZat = raw ? toZatoshis(raw.chainValueZat, raw.chainValue) : 0n;
    const monitored = Boolean(raw?.monitored);
    const name = id.charAt(0).toUpperCase() + id.slice(1);
    parsedPools.push({ id, name, chainValueZat, monitored });
  }

  // 2. Process any additional/unknown pools cleanly by id
  for (const raw of rawPools) {
    if (raw && raw.id) {
      const lower = raw.id.toLowerCase();
      if (!seenIds.has(lower)) {
        seenIds.add(lower);
        const chainValueZat = toZatoshis(raw.chainValueZat, raw.chainValue);
        const monitored = Boolean(raw.monitored);
        const name = raw.id.charAt(0).toUpperCase() + raw.id.slice(1);
        parsedPools.push({ id: lower, name, chainValueZat, monitored });
      }
    }
  }

  // 3. Compute total shielded supply (sum of all shielded pools)
  let totalShieldedSupplyZat = 0n;
  for (const pool of parsedPools) {
    if (SHIELDED_POOLS.has(pool.id) || (pool.id !== 'transparent' && pool.id !== 'lockbox')) {
      totalShieldedSupplyZat += pool.chainValueZat;
    }
  }

  // 4. Compute total chain supply
  let totalChainSupplyZat = 0n;
  if (bci.chainSupply?.chainValueZat !== undefined || bci.chainSupply?.chainValue !== undefined) {
    totalChainSupplyZat = toZatoshis(bci.chainSupply.chainValueZat, bci.chainSupply.chainValue);
  } else {
    for (const pool of parsedPools) {
      totalChainSupplyZat += pool.chainValueZat;
    }
  }

  return {
    chain: bci.chain || 'unknown',
    tipHeight: bci.blocks ?? bci.headers ?? 'unknown',
    totalChainSupplyZat,
    totalShieldedSupplyZat,
    pools: parsedPools,
  };
}

export function formatSupply(bci: BlockchainInfo, options?: FormatOptions): string {
  const c = createColors(shouldColor(options));
  const parsed = parseSupplyInfo(bci);

  const lines: string[] = [];

  lines.push(`${c.bold('Chain:')} ${c.cyan(parsed.chain)} (tip height: ${c.yellow(String(parsed.tipHeight))})`);
  lines.push(
    `${c.bold('Total Chain supply:')}    ${c.green(formatZec(parsed.totalChainSupplyZat))} ZEC ` +
      `(${c.dim(formatZatoshis(parsed.totalChainSupplyZat) + ' zatoshis')})`
  );
  lines.push(
    `${c.bold('Total Shielded supply:')} ${c.magenta(formatZec(parsed.totalShieldedSupplyZat))} ZEC ` +
      `(${c.dim(formatZatoshis(parsed.totalShieldedSupplyZat) + ' zatoshis')})`
  );

  lines.push('─'.repeat(74));
  const colPool = 14;
  const colZec = 18;
  const colZat = 24;
  const colMon = 12;

  const header =
    padRight(c.bold('Pool'), colPool) +
    padLeft(c.bold('Balance (ZEC)'), colZec) +
    padLeft(c.bold('Balance (Zatoshis)'), colZat) +
    padLeft(c.bold('Monitored'), colMon);
  lines.push(header);
  lines.push('─'.repeat(74));

  for (const pool of parsed.pools) {
    const isShielded = SHIELDED_POOLS.has(pool.id);
    const poolNameColored = isShielded ? c.magenta(pool.name) : c.white(pool.name);
    const zecFormatted = formatZec(pool.chainValueZat);
    const zatFormatted = formatZatoshis(pool.chainValueZat);
    const monStr = pool.monitored ? c.green('yes') : c.dim('no');

    const row =
      padRight(poolNameColored, colPool) +
      padLeft(zecFormatted, colZec) +
      padLeft(zatFormatted, colZat) +
      padLeft(monStr, colMon);
    lines.push(row);
  }

  lines.push('─'.repeat(74));
  return lines.join('\n');
}

