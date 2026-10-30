import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NETWORK_PRESETS, Network, PresetId } from '../../endpoints';

/**
 * Which backend actually produced the explorer response. Every response carries this so a
 * caller can tell a local node answer from a third-party one (or from captured fixture data).
 */
export type ExplorerSource =
  | 'local-lightwalletd'
  | 'local-zebra-rpc'
  | 'third-party-rpc'
  | 'third-party-lightwalletd'
  | 'fixture';

export const THIRD_PARTY_FALLBACK_ENV = 'ZCASH_EXPLORER_THIRD_PARTY_FALLBACK';
export const FIXTURES_ENV = 'ZCASH_EXPLORER_FIXTURES';

/** Third-party (QuickNode / secondary) fallback is opt-in and off by default. */
export function thirdPartyFallbackEnabled(): boolean {
  return process.env[THIRD_PARTY_FALLBACK_ENV] === '1';
}

/** Captured chain fixtures are served only when explicitly enabled. */
export function fixturesEnabled(): boolean {
  return process.env[FIXTURES_ENV] === '1';
}

export function isLoopbackEndpoint(endpointOrUrl: string): boolean {
  const trimmed = String(endpointOrUrl || '').trim();
  if (!trimmed) return false;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const authority = withoutScheme.split('/')[0];
  const hostPort = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  const host = hostPort.startsWith('[')
    ? hostPort.slice(0, hostPort.indexOf(']') + 1)
    : hostPort.split(':')[0];
  const normalized = host.toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]';
}

export function sourceForLightwalletd(endpoint: string): ExplorerSource {
  return isLoopbackEndpoint(endpoint) ? 'local-lightwalletd' : 'third-party-lightwalletd';
}

export function sourceForRpc(url: string): ExplorerSource {
  return isLoopbackEndpoint(url) ? 'local-zebra-rpc' : 'third-party-rpc';
}

export function explorerError(
  status: number,
  error: string,
  code: string,
  source: ExplorerSource | null = null
): Response {
  return Response.json({ success: false, error, code, source }, { status });
}

export interface ZebraCookieCredentials {
  user: string;
  password: string;
}

/** Zebra writes its RPC credentials as a single `user:password` line. */
export function parseZebraCookie(raw: string): ZebraCookieCredentials | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx <= 0 || colonIdx === trimmed.length - 1) return null;
  const user = trimmed.slice(0, colonIdx);
  const password = trimmed.slice(colonIdx + 1);
  if (!user || !password) return null;
  return { user, password };
}

export function buildZebraRpcUrl(credentials: ZebraCookieCredentials, port = 18232): string {
  return `http://${encodeURIComponent(credentials.user)}:${encodeURIComponent(
    credentials.password
  )}@127.0.0.1:${port}`;
}

export function zebraCookieCandidatePaths(): string[] {
  // An explicit path wins, so tests (and alternate layouts) never read the real user cache.
  const explicit = process.env.ZCASH_ZEBRA_COOKIE_PATH;
  if (explicit) return [explicit];
  return [
    path.join(os.homedir(), 'Library', 'Caches', 'zebra', '.cookie'),
    path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'zebra', '.cookie'),
  ];
}

export function getZebraCookieRpcUrl(port = 18232): string | null {
  for (const cookiePath of zebraCookieCandidatePaths()) {
    try {
      if (!fs.existsSync(cookiePath)) continue;
      const credentials = parseZebraCookie(fs.readFileSync(cookiePath, 'utf8'));
      if (!credentials) continue;
      return buildZebraRpcUrl(credentials, port);
    } catch {
      continue;
    }
  }
  return null;
}

/** Opt-in third-party JSON-RPC fallback. Returns null unless the flag is set. */
export function getThirdPartyRpcFallbackUrl(): string | null {
  if (!thirdPartyFallbackEnabled()) return null;

  const fromEnv = process.env.QUICKNODE_ZEC_TESTNET_URL || process.env.ZCASH_SECONDARY_ENDPOINT;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  try {
    const envPaths = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '../.env'),
      path.resolve(process.cwd(), '../../.env'),
    ];
    for (const ep of envPaths) {
      if (fs.existsSync(ep)) {
        const content = fs.readFileSync(ep, 'utf8');
        const m = content.match(/QUICKNODE_.*=(.*)/) || content.match(/ZCASH_SECONDARY_ENDPOINT=(.*)/);
        if (m && m[1]) return m[1].trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Opt-in third-party lightwalletd, taken from NETWORK_PRESETS rather than a hard-coded host.
 * Regtest never falls back off-box.
 */
export function getFallbackLightwalletdEndpoint(network: Network): string | null {
  if (!thirdPartyFallbackEnabled()) return null;
  if (network === 'regtest') return null;
  const presetId: PresetId = network === 'mainnet' ? 'mainnet' : 'testnet';
  return NETWORK_PRESETS[presetId]?.endpoint || null;
}

export function getSecondaryRpcUrl(presetParam?: PresetId | null): string | null {
  if (process.env.ZEBRA_RPC_URL) {
    return process.env.ZEBRA_RPC_URL;
  }
  if (presetParam && NETWORK_PRESETS[presetParam]?.miningRpcUrl) {
    return NETWORK_PRESETS[presetParam].miningRpcUrl!;
  }
  if (presetParam === 'testnet-local') {
    return getZebraCookieRpcUrl(18232) || 'http://127.0.0.1:18232';
  }
  return getThirdPartyRpcFallbackUrl();
}
