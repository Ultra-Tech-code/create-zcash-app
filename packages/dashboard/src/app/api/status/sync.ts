import { PresetId, NETWORK_PRESETS, Network } from '../../endpoints';
import { getZebraCookieRpcUrl, getThirdPartyRpcFallbackUrl } from '../explorer/backend';

export interface RawBlockchainInfo {
  blocks?: number | string | null;
  headers?: number | string | null;
  estimatedheight?: number | string | null;
  estimated_height?: number | string | null;
  estimatedHeight?: number | string | null;
  verificationprogress?: number | string | null;
  verification_progress?: number | string | null;
  verificationProgress?: number | string | null;
  chain?: string | null;
}

export type SyncState = 'synced' | 'syncing' | 'regtest' | 'unknown';

export interface NodeSyncInfo {
  blocks: number | null;
  headers: number | null;
  estimatedHeight: number | null;
  verificationProgress: number | null;
  syncPercent: number | null;
  syncState: SyncState;
  indexerBehind: number | null;
  indexerBehindMessage: string | null;
  nodeRpcUrl?: string | null;
}

export function redactSecretUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed.includes('://')) {
    if (trimmed.includes('@')) {
      return trimmed.replace(/^[^@]+@/, '<redacted>@');
    }
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const hasAuth = Boolean(parsed.username || parsed.password);
    const hasPathSecret = parsed.pathname.length > 1;
    const hasQuerySecret = parsed.search.length > 1;
    if (hasAuth || hasPathSecret || hasQuerySecret) {
      const portPart = parsed.port ? `:${parsed.port}` : '';
      return `${parsed.protocol}//${parsed.hostname}${portPart}/<redacted>`;
    }
    return trimmed;
  } catch {
    return trimmed
      .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@]+@([^\s/]+)/, '$1<redacted>@$2')
      .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/?]+)\/[^\s]+/, '$1/<redacted>')
      .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/?]+)\?[^\s]+/, '$1/<redacted>');
  }
}

export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function calculateSyncStatus(
  rawInfo: RawBlockchainInfo | null | undefined,
  network: Network,
  indexerHeight?: number | null
): NodeSyncInfo {
  if (!rawInfo || typeof rawInfo !== 'object') {
    return {
      blocks: null,
      headers: null,
      estimatedHeight: null,
      verificationProgress: null,
      syncPercent: null,
      syncState: 'unknown',
      indexerBehind: null,
      indexerBehindMessage: null,
    };
  }

  const rawBlocks = rawInfo.blocks;
  const rawHeaders = rawInfo.headers;
  const rawEstHeight =
    rawInfo.estimatedheight ?? rawInfo.estimated_height ?? rawInfo.estimatedHeight;
  const rawVerProgress =
    rawInfo.verificationprogress ?? rawInfo.verification_progress ?? rawInfo.verificationProgress;

  const blocks = rawBlocks != null && !Number.isNaN(Number(rawBlocks)) ? Number(rawBlocks) : null;
  const headers = rawHeaders != null && !Number.isNaN(Number(rawHeaders)) ? Number(rawHeaders) : null;
  const estimatedHeight =
    rawEstHeight != null && !Number.isNaN(Number(rawEstHeight)) ? Number(rawEstHeight) : null;
  const verificationProgress =
    rawVerProgress != null && !Number.isNaN(Number(rawVerProgress)) ? Number(rawVerProgress) : null;

  if (blocks === null) {
    return {
      blocks: null,
      headers,
      estimatedHeight,
      verificationProgress,
      syncPercent: null,
      syncState: 'unknown',
      indexerBehind: null,
      indexerBehindMessage: null,
    };
  }

  // Calculate indexerBehind if indexerHeight is available
  let indexerBehind: number | null = null;
  let indexerBehindMessage: string | null = null;
  if (indexerHeight != null && !Number.isNaN(Number(indexerHeight))) {
    const diff = blocks - Number(indexerHeight);
    indexerBehind = Math.max(0, diff);
    if (indexerBehind === 0) {
      indexerBehindMessage = 'indexer is at node tip';
    } else {
      indexerBehindMessage = `indexer ${indexerBehind} block${indexerBehind === 1 ? '' : 's'} behind`;
    }
  }

  // Regtest network has no external tip estimate
  if (network === 'regtest') {
    return {
      blocks,
      headers: headers ?? blocks,
      estimatedHeight: null,
      verificationProgress: null,
      syncPercent: null,
      syncState: 'regtest',
      indexerBehind,
      indexerBehindMessage,
    };
  }

  // Calculate syncPercent:
  // syncPercent = min(100, round(blocks / estimatedHeight * 100, 2)) when estimatedHeight > 0;
  // fall back to verification_progress*100 when only that exists; null otherwise.
  let syncPercent: number | null = null;
  if (estimatedHeight !== null && estimatedHeight > 0) {
    syncPercent = Math.min(100, round((blocks / estimatedHeight) * 100, 2));
  } else if (verificationProgress !== null && !Number.isNaN(verificationProgress)) {
    syncPercent = Math.min(100, Math.max(0, round(verificationProgress * 100, 2)));
  }

  // syncState: "synced" (>= 99.9% or blocks >= headers and within 2 blocks of estimate),
  // "syncing", "unknown" (RPC unreachable or fields missing, never show a fake 0% or 100%).
  let syncState: SyncState = 'syncing';

  const isPercentSynced = syncPercent !== null && syncPercent >= 99.9;
  const isBlocksSynced =
    headers !== null &&
    blocks >= headers &&
    estimatedHeight !== null &&
    Math.abs(estimatedHeight - blocks) <= 2;

  if (isPercentSynced || isBlocksSynced) {
    syncState = 'synced';
  } else if (syncPercent === null && verificationProgress === null) {
    syncState = 'unknown';
  } else {
    syncState = 'syncing';
  }

  return {
    blocks,
    headers,
    estimatedHeight,
    verificationProgress,
    syncPercent,
    syncState,
    indexerBehind,
    indexerBehindMessage,
  };
}

export function getPresetZebraRpcUrl(
  presetParam?: PresetId | null,
  network: Network = 'regtest'
): string | null {
  if (process.env.ZEBRA_RPC_URL) {
    return process.env.ZEBRA_RPC_URL;
  }
  if (presetParam && NETWORK_PRESETS[presetParam]?.miningRpcUrl) {
    return NETWORK_PRESETS[presetParam].miningRpcUrl!;
  }
  if (presetParam === 'testnet-local') {
    return getZebraCookieRpcUrl(18232) || 'http://127.0.0.1:18232';
  }
  if (network === 'testnet') {
    const localCookieUrl = getZebraCookieRpcUrl(18232);
    if (localCookieUrl) return localCookieUrl;
    return getThirdPartyRpcFallbackUrl() || 'http://127.0.0.1:18232';
  }
  if (network === 'mainnet') {
    const localCookieUrl = getZebraCookieRpcUrl(8232);
    if (localCookieUrl) return localCookieUrl;
    return getThirdPartyRpcFallbackUrl();
  }
  return null;
}

export async function fetchZebraBlockchainInfo(
  rpcUrl: string,
  timeoutMs = 3000
): Promise<RawBlockchainInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const u = new URL(rpcUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (u.username || u.password) {
      const auth = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
      headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
    }

    const cleanUrl = `${u.protocol}//${u.host}${u.pathname}`;

    const res = await fetch(cleanUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'dashboard-sync-status',
        method: 'getblockchaininfo',
        params: [],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json && json.result && typeof json.result === 'object') {
      return json.result;
    }
    return null;
  } catch {
    return null;
  }
}
