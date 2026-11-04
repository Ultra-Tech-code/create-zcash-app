/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import { createColors, shouldColor } from './format';
import { FormatOptions } from './types';

export function formatMempool(mempool: string[] | any[], options?: FormatOptions): string {
  const c = createColors(shouldColor(options));
  const lines: string[] = [];
  const list = Array.isArray(mempool) ? mempool : [];

  lines.push('─'.repeat(74));
  lines.push(`${c.bold('Mempool status:')} ${c.yellow(String(list.length))} transaction(s) pending`);
  lines.push('─'.repeat(74));

  if (list.length === 0) {
    lines.push(c.dim('(mempool is empty)'));
  } else {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const txid = typeof item === 'string' ? item : item?.txid || JSON.stringify(item);
      lines.push(`  [${i}] ${c.cyan(txid)}`);
    }
  }

  lines.push('─'.repeat(74));
  return lines.join('\n');
}

