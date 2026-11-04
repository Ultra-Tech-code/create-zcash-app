/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import {
  createColors,
  formatTimestamp,
  padLeft,
  padRight,
  shouldColor,
} from './format';
import { FormatOptions, PeerInfo } from './types';

export function formatPeers(peers: PeerInfo[], options?: FormatOptions): string {
  const c = createColors(shouldColor(options));
  const lines: string[] = [];
  const count = Array.isArray(peers) ? peers.length : 0;

  lines.push('─'.repeat(74));
  if (count === 0) {
    lines.push(c.dim('No connected peers found.'));
  } else {
    const colAddr = 24;
    const colDir = 10;
    const colVer = 10;
    const colAgent = 20;
    const colTime = 22;

    const header =
      padRight(c.bold('Address'), colAddr) +
      padRight(c.bold('Direction'), colDir) +
      padRight(c.bold('Version'), colVer) +
      padRight(c.bold('User Agent'), colAgent) +
      padLeft(c.bold('Connected Time'), colTime);
    lines.push(header);
    lines.push('─'.repeat(74));

    for (const peer of peers) {
      const addr = peer.addr || 'unknown';
      const dir = peer.inbound ? 'inbound' : 'outbound';
      const dirColored = peer.inbound ? c.cyan(dir) : c.green(dir);
      const ver = peer.version ? String(peer.version) : '-';
      const agent = peer.subver || '-';
      const timeStr = peer.conntime ? formatTimestamp(peer.conntime, options?.local) : '-';

      const row =
        padRight(c.yellow(addr), colAddr) +
        padRight(dirColored, colDir) +
        padRight(ver, colVer) +
        padRight(c.dim(agent), colAgent) +
        padLeft(timeStr, colTime);
      lines.push(row);
    }
  }

  lines.push('─'.repeat(74));
  lines.push('');
  lines.push(`Your Zebrad node has ${c.bold(c.green(String(count)))} ip('s) connected.`);
  return lines.join('\n');
}

