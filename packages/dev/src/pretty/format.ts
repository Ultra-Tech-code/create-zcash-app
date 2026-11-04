/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import { FormatOptions } from './types';

export function formatZec(zatoshis: bigint | number | string): string {
  try {
    const val = BigInt(zatoshis);
    const neg = val < 0n;
    const abs = neg ? -val : val;
    const whole = abs / 100_000_000n;
    const frac = (abs % 100_000_000n).toString().padStart(8, '0');
    return `${neg ? '-' : ''}${whole}.${frac}`;
  } catch {
    return String(zatoshis);
  }
}

export function formatZatoshis(zatoshis: bigint | number | string): string {
  try {
    const val = BigInt(zatoshis);
    const neg = val < 0n;
    const abs = neg ? -val : val;
    const s = abs.toString();
    const parts: string[] = [];
    let rem = s;
    while (rem.length > 3) {
      parts.unshift(rem.slice(-3));
      rem = rem.slice(0, -3);
    }
    if (rem.length > 0) {
      parts.unshift(rem);
    }
    return `${neg ? '-' : ''}${parts.join(',')}`;
  } catch {
    return String(zatoshis);
  }
}

export function parseZecAmountToZatoshis(amount: string | number): bigint {
  const str = String(amount ?? '').trim();
  if (!str) return 0n;
  const neg = str.startsWith('-');
  const unsigned = neg ? str.slice(1) : str;

  // Handle standard decimal numbers
  const [whole, fraction = ''] = unsigned.split('.');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error(`Invalid ZEC amount string: "${amount}"`);
  }

  const cleanWhole = whole === '' ? 0n : BigInt(whole);
  const wholeZat = cleanWhole * 100_000_000n;
  const cleanFrac = fraction.slice(0, 8).padEnd(8, '0');
  const fractionZat = BigInt(cleanFrac);
  const total = wholeZat + fractionZat;
  return neg ? -total : total;
}

export function toZatoshis(valZat: any, fallbackZec?: any): bigint {
  if (valZat !== undefined && valZat !== null) {
    if (typeof valZat === 'bigint') return valZat;
    if (typeof valZat === 'number') return BigInt(Math.round(valZat));
    const str = String(valZat).trim();
    if (/^-?\d+$/.test(str)) {
      return BigInt(str);
    }
  }
  if (fallbackZec !== undefined && fallbackZec !== null) {
    return parseZecAmountToZatoshis(fallbackZec);
  }
  return 0n;
}

export function formatTimestamp(unixSeconds: number | bigint, local: boolean = false): string {
  const d = new Date(Number(unixSeconds) * 1000);
  if (isNaN(d.getTime())) return 'n/a';
  if (!local) {
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());

  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const tzHours = pad(Math.floor(absOffset / 60));
  const tzMins = pad(absOffset % 60);

  return `${year}-${month}-${day}T${hours}:${mins}:${secs}${sign}${tzHours}:${tzMins}`;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function visualLength(str: string): number {
  return stripAnsi(str).length;
}

export function padRight(str: string, targetWidth: number): string {
  const current = visualLength(str);
  if (current >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - current);
}

export function padLeft(str: string, targetWidth: number): string {
  const current = visualLength(str);
  if (current >= targetWidth) return str;
  return ' '.repeat(targetWidth - current) + str;
}

export function shouldColor(options?: FormatOptions): boolean {
  if (options?.noColor) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return Boolean(process.stdout && process.stdout.isTTY);
}

export interface ColorHelpers {
  bold: (s: string) => string;
  dim: (s: string) => string;
  cyan: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  magenta: (s: string) => string;
  gray: (s: string) => string;
  blue: (s: string) => string;
  white: (s: string) => string;
}

export function createColors(enabled: boolean): ColorHelpers {
  if (!enabled) {
    const id = (s: string) => s;
    return {
      bold: id,
      dim: id,
      cyan: id,
      green: id,
      yellow: id,
      red: id,
      magenta: id,
      gray: id,
      blue: id,
      white: id,
    };
  }
  return {
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    magenta: (s) => `\x1b[35m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    blue: (s) => `\x1b[34m${s}\x1b[0m`,
    white: (s) => `\x1b[37m${s}\x1b[0m`,
  };
}
