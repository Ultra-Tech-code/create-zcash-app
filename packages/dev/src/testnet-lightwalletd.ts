import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TestnetLightwalletdOptions {
  rpcHost?: string;
  rpcPort?: number | string;
  cookieUser?: string;
  cookieToken: string;
  grpcBind?: string;
  httpBind?: string;
  dataDir?: string;
}

/**
 * Reads Zebra's RPC cookie file by code and extracts credentials.
 * Zebra generates a fresh token each time the process restarts.
 */
export function readZebraCookie(customPath?: string): { user: string; token: string } {
  const cookiePath = customPath || path.join(os.homedir(), 'Library/Caches/zebra/.cookie');
  if (!fs.existsSync(cookiePath)) {
    throw new Error(
      `Zebra cookie file not found at ${cookiePath.replace(os.homedir(), '~')}. Is your local testnet Zebra node running? Note that Zebra generates a fresh cookie token each time it restarts.`
    );
  }

  const content = fs.readFileSync(cookiePath, 'utf8').trim();
  const sepIdx = content.indexOf(':');
  if (sepIdx === -1) {
    throw new Error(
      `Invalid Zebra cookie format in ${cookiePath.replace(os.homedir(), '~')}. Expected __cookie__:<hex-token>.`
    );
  }

  const user = content.slice(0, sepIdx);
  const token = content.slice(sepIdx + 1).trim();
  if (!token) {
    throw new Error(`Empty token in Zebra cookie file ${cookiePath.replace(os.homedir(), '~')}.`);
  }

  return { user, token };
}

/**
 * Builds the exact command arguments for running lightwalletd v0.6.0
 * connected to a local testnet Zebra node using only genuine v0.6.0 flags.
 *
 * Real flags verified from `lightwalletd --help`:
 *   --rpchost 127.0.0.1
 *   --rpcport 18232
 *   --rpcuser __cookie__
 *   --rpcpassword <token>
 *   --grpc-bind-addr 127.0.0.1:39167
 *   --http-bind-addr 127.0.0.1:39168
 *   --data-dir <dir>
 *   --no-tls-very-insecure
 */
export function buildTestnetLightwalletdArgs(options: TestnetLightwalletdOptions): string[] {
  const rpcHost = options.rpcHost || '127.0.0.1';
  const rpcPort = String(options.rpcPort || '18232');
  const cookieUser = options.cookieUser || '__cookie__';
  const grpcBind = options.grpcBind || '127.0.0.1:39167';
  const httpBind = options.httpBind || '127.0.0.1:39168';
  const dataDir = options.dataDir || path.join(os.homedir(), '.zcash-app-testnet/lightwalletd-data');

  if (!options.cookieToken) {
    throw new Error('Cannot build lightwalletd arguments without an RPC password / cookie token.');
  }

  return [
    '--rpchost',
    rpcHost,
    '--rpcport',
    rpcPort,
    '--rpcuser',
    cookieUser,
    '--rpcpassword',
    options.cookieToken,
    '--grpc-bind-addr',
    grpcBind,
    '--http-bind-addr',
    httpBind,
    '--data-dir',
    dataDir,
    '--no-tls-very-insecure',
  ];
}

/**
 * Redacts secret token and normalizes home directory paths for safe logging.
 * Guarantees that the secret cookie token is never emitted in logs or stdout.
 */
export function redactLightwalletdArgs(args: string[], secretToken?: string): string[] {
  const result: string[] = [];
  const home = os.homedir();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rpcpassword') {
      result.push('--rpcpassword');
      result.push('[REDACTED]');
      i++;
    } else {
      let val = args[i].replace(home, '~');
      if (secretToken && secretToken.length > 0 && val.includes(secretToken)) {
        val = val.replace(secretToken, '[REDACTED]');
      }
      result.push(val);
    }
  }

  return result;
}
