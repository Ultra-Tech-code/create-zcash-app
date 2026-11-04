/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import {
  createColors,
  formatTimestamp,
  formatZatoshis,
  formatZec,
  padLeft,
  padRight,
  shouldColor,
  toZatoshis,
} from './format';
import { KNOWN_POOLS, SHIELDED_POOLS } from './supply';
import { Block, FormatOptions, ValuePool } from './types';

export function formatBlock(block: Block, options?: FormatOptions): string {
  const c = createColors(shouldColor(options));
  const lines: string[] = [];

  lines.push(`${c.bold('Block Height:')}     ${c.yellow(String(block.height))}`);
  lines.push(`${c.bold('Block Hash:')}       ${c.cyan(block.hash)}`);
  lines.push(`${c.bold('Confirmations:')}    ${c.green(String(block.confirmations))}`);
  lines.push(
    `${c.bold('Timestamp:')}        ${formatTimestamp(block.time, options?.local)} ${
      options?.local ? c.dim('(local)') : c.dim('(UTC)')
    }`
  );
  lines.push(`${c.bold('Size:')}             ${formatZatoshis(block.size)} bytes`);
  lines.push(`${c.bold('Version:')}          ${block.version}`);
  lines.push(`${c.bold('Merkle Root:')}      ${c.dim(block.merkleroot)}`);
  if (block.blockcommitments) {
    lines.push(`${c.bold('Commitments Root:')} ${c.dim(block.blockcommitments)}`);
  }

  // Transactions list
  const txCount = block.nTx ?? block.tx?.length ?? 0;
  lines.push(`${c.bold('Transactions:')}     ${c.bold(String(txCount))} tx(s)`);
  if (Array.isArray(block.tx) && block.tx.length > 0) {
    const maxDisplay = 10;
    const toShow = block.tx.slice(0, maxDisplay);
    for (let i = 0; i < toShow.length; i++) {
      const isCoinbase = i === 0;
      const tag = isCoinbase ? c.yellow(' (coinbase)') : '';
      lines.push(`  [${i}] ${c.cyan(toShow[i])}${tag}`);
    }
    if (block.tx.length > maxDisplay) {
      lines.push(`  ${c.dim(`... and ${block.tx.length - maxDisplay} more transaction(s)`)}`);
    }
  }

  // Chain Supply if present
  if (block.chainSupply) {
    const supplyZat = toZatoshis(block.chainSupply.chainValueZat, block.chainSupply.chainValue);
    lines.push(
      `${c.bold('Chain Supply:')}     ${c.green(formatZec(supplyZat))} ZEC (${c.dim(
        formatZatoshis(supplyZat) + ' zatoshis'
      )})`
    );
  }

  // Value Pools
  if (Array.isArray(block.valuePools) && block.valuePools.length > 0) {
    lines.push('');
    lines.push(c.bold('Value Pools:'));
    lines.push('─'.repeat(74));
    const colPool = 14;
    const colDelta = 20;
    const colBal = 24;
    const colMon = 12;

    const header =
      padRight(c.bold('Pool'), colPool) +
      padLeft(c.bold('Delta (ZEC)'), colDelta) +
      padLeft(c.bold('Balance (ZEC)'), colBal) +
      padLeft(c.bold('Monitored'), colMon);
    lines.push(header);
    lines.push('─'.repeat(74));

    const poolMap = new Map<string, ValuePool>();
    for (const p of block.valuePools) {
      if (p && p.id) {
        poolMap.set(p.id.toLowerCase(), p);
      }
    }

    const seenIds = new Set<string>();
    for (const id of KNOWN_POOLS) {
      seenIds.add(id);
      const raw = poolMap.get(id);
      if (!raw) continue;
      const deltaZat = toZatoshis(raw.valueDeltaZat, raw.valueDelta);
      const balZat = toZatoshis(raw.chainValueZat, raw.chainValue);
      const isShielded = SHIELDED_POOLS.has(id);
      const name = id.charAt(0).toUpperCase() + id.slice(1);
      const nameColored = isShielded ? c.magenta(name) : c.white(name);

      const sign = deltaZat > 0n ? '+' : '';
      const deltaStr = `${sign}${formatZec(deltaZat)}`;
      const balStr = formatZec(balZat);
      const monStr = raw.monitored ? c.green('yes') : c.dim('no');

      const row =
        padRight(nameColored, colPool) +
        padLeft(deltaStr, colDelta) +
        padLeft(balStr, colBal) +
        padLeft(monStr, colMon);
      lines.push(row);
    }

    // Any unknown pool
    for (const raw of block.valuePools) {
      if (raw && raw.id && !seenIds.has(raw.id.toLowerCase())) {
        const id = raw.id.toLowerCase();
        seenIds.add(id);
        const deltaZat = toZatoshis(raw.valueDeltaZat, raw.valueDelta);
        const balZat = toZatoshis(raw.chainValueZat, raw.chainValue);
        const name = raw.id.charAt(0).toUpperCase() + raw.id.slice(1);
        const sign = deltaZat > 0n ? '+' : '';
        const row =
          padRight(c.white(name), colPool) +
          padLeft(`${sign}${formatZec(deltaZat)}`, colDelta) +
          padLeft(formatZec(balZat), colBal) +
          padLeft(raw.monitored ? c.green('yes') : c.dim('no'), colMon);
        lines.push(row);
      }
    }
    lines.push('─'.repeat(74));
  }

  // Commitment Trees
  if (block.trees && typeof block.trees === 'object') {
    const treeEntries = Object.entries(block.trees);
    if (treeEntries.length > 0) {
      lines.push('');
      lines.push(c.bold('Commitment Trees:'));
      for (const [poolName, tree] of treeEntries) {
        const cap = poolName.charAt(0).toUpperCase() + poolName.slice(1);
        lines.push(`  ${c.bold(cap + ' Tree Size:')} ${c.yellow(String(tree?.size ?? 0))}`);
      }
    }
  }

  return lines.join('\n');
}

