/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import fs from 'fs';
import { loadProjectEnv } from '../env';
import { redactSecretUrl, sanitizeError } from '../redact';

export interface ZebraRpcClientOptions {
  endpoint?: string;
  cookieFile?: string;
}

export class ZebraRpcClient {
  public readonly endpoint: string;
  private readonly authHeader?: string;

  constructor(options?: ZebraRpcClientOptions) {
    const env = loadProjectEnv();
    const rawEndpoint = options?.endpoint || env.ZCASH_ZEBRA_RPC || 'http://127.0.0.1:39232';

    let cleanEndpoint = rawEndpoint;
    let basicAuth: string | undefined;

    // 1. Check if URL contains credentials: http://user:pass@host:port
    try {
      if (rawEndpoint.includes('://')) {
        const parsed = new URL(rawEndpoint);
        if (parsed.username || parsed.password) {
          basicAuth = `${parsed.username}:${parsed.password}`;
          parsed.username = '';
          parsed.password = '';
          cleanEndpoint = parsed.toString().replace(/\/$/, '');
        }
      }
    } catch {
      // Fallback: keep rawEndpoint
    }

    // 2. Check cookie file if no URL basic auth
    const cookiePath = options?.cookieFile || env.ZCASH_ZEBRA_COOKIE_FILE || process.env.ZCASH_ZEBRA_COOKIE_FILE;
    if (cookiePath && fs.existsSync(cookiePath)) {
      try {
        const cookieContent = fs.readFileSync(cookiePath, 'utf8').trim();
        if (cookieContent) {
          basicAuth = cookieContent;
        }
      } catch (err) {
        throw sanitizeError(new Error(`Failed to read cookie file: ${(err as Error).message}`));
      }
    }

    this.endpoint = cleanEndpoint;
    if (basicAuth) {
      this.authHeader = `Basic ${Buffer.from(basicAuth).toString('base64')}`;
    }
  }

  public async call<T = any>(method: string, params: any[] = []): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'zcash-dev-pretty',
          method,
          params,
        }),
      });
    } catch (err: any) {
      const redacted = redactSecretUrl(this.endpoint);
      throw sanitizeError(new Error(`Could not connect to Zebra JSON-RPC at ${redacted}: ${err.message}`));
    }

    if (!response.ok) {
      const redacted = redactSecretUrl(this.endpoint);
      throw sanitizeError(
        new Error(`Zebra JSON-RPC at ${redacted} returned HTTP status ${response.status} ${response.statusText}`)
      );
    }

    let json: any;
    try {
      json = await response.json();
    } catch (err: any) {
      throw sanitizeError(new Error(`Failed to parse JSON response from Zebra: ${err.message}`));
    }

    if (json.error) {
      const msg = typeof json.error === 'string' ? json.error : json.error.message || JSON.stringify(json.error);
      throw sanitizeError(new Error(`Zebra RPC error [${method}]: ${msg}`));
    }

    return json.result as T;
  }
}

