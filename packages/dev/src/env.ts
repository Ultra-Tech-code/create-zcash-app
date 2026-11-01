import fs from 'fs';
import path from 'path';

export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

export function loadProjectEnv(
  cwd: string = process.cwd(),
  processEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const envPath = path.join(cwd, '.env');
  const envLocalPath = path.join(cwd, '.env.local');

  const fromEnv = fs.existsSync(envPath)
    ? parseEnvContent(fs.readFileSync(envPath, 'utf8'))
    : {};
  const fromLocal = fs.existsSync(envLocalPath)
    ? parseEnvContent(fs.readFileSync(envLocalPath, 'utf8'))
    : {};

  // Precedence: processEnv wins > .env.local > .env
  const merged: Record<string, string> = { ...fromEnv, ...fromLocal };
  for (const [k, v] of Object.entries(processEnv)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  return merged;
}

export function applyProjectEnv(cwd: string = process.cwd()): Record<string, string> {
  const config = loadProjectEnv(cwd);
  for (const [k, v] of Object.entries(config)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
  return config;
}

export function formatZec(zatoshis: bigint | number): string {
  try {
    const val = BigInt(zatoshis);
    const neg = val < 0n;
    const abs = neg ? -val : val;
    const whole = abs / 100000000n;
    const frac = (abs % 100000000n).toString().padStart(8, '0');
    return `${neg ? '-' : ''}${whole}.${frac}`;
  } catch {
    return String(zatoshis);
  }
}

export function parseZecToZatoshis(amountStr: string): bigint {
  const trimmed = (amountStr ?? '').trim();
  if (!trimmed || !/^\d+(\.\d{1,8})?$/.test(trimmed)) {
    throw new Error(`Invalid ZEC amount: "${amountStr}". Expected decimal number with up to 8 decimal places.`);
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const wholeZat = BigInt(whole) * 100000000n;
  const fractionZat = BigInt(fraction.padEnd(8, '0'));
  const total = wholeZat + fractionZat;
  if (total <= 0n) {
    throw new Error(`Amount must be greater than zero, got ${amountStr} ZEC`);
  }
  return total;
}

