import crypto from 'node:crypto';

export interface SessionData {
  ufvk: string;
  birthday: number;
  network: string;
  accountId?: string;
}

// In-memory session store keyed by session ID
// Held strictly in server memory, never persisted in localStorage, never in URLs, never logged.
const sessionStore = new Map<string, SessionData>();

export const SESSION_COOKIE_NAME = 'zcash_dashboard_session';

export function getSession(sessionId: string): SessionData | undefined {
  return sessionStore.get(sessionId);
}

export function setSession(sessionId: string, data: SessionData): void {
  sessionStore.set(sessionId, data);
}

export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId);
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

export function getSessionIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;\\s]+)`));
  return match ? match[1] : null;
}

export function validateUfvkPrefix(
  ufvk: string,
  network: string
): { valid: boolean; error?: string } {
  const trimmed = ufvk.trim();
  if (network === 'mainnet') {
    if (!trimmed.startsWith('uview1')) {
      return {
        valid: false,
        error: `Invalid UFVK prefix for mainnet: expected key starting with 'uview1', got '${trimmed.slice(0, 10)}...'`,
      };
    }
  } else if (network === 'testnet') {
    if (!trimmed.startsWith('uviewtest1')) {
      return {
        valid: false,
        error: `Invalid UFVK prefix for testnet: expected key starting with 'uviewtest1', got '${trimmed.slice(0, 12)}...'`,
      };
    }
  } else if (network === 'regtest') {
    if (!trimmed.startsWith('uviewregtest1')) {
      return {
        valid: false,
        error: `Invalid UFVK prefix for regtest: expected key starting with 'uviewregtest1', got '${trimmed.slice(0, 15)}...'`,
      };
    }
  }
  return { valid: true };
}
