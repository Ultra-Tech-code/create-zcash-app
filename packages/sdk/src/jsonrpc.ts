export interface JsonRpcResponse<T = any> {
  jsonrpc: string;
  id: string | number;
  result: T;
  error?: {
    code: number;
    message: string;
  } | null;
}

export interface JsonRpcBlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  consensus?: {
    branchId?: string;
    nextblock?: string;
  };
  upgrades?: Record<
    string,
    {
      name: string;
      activationheight: number;
      status: string;
      branchid?: string;
    }
  >;
  subversion?: string;
  version?: number;
}

export interface JsonRpcTreeState {
  height: number;
  hash: string;
  time: number;
  sapling?: {
    commitments?: {
      finalRoot?: string;
      finalState?: string;
    };
  };
  orchard?: {
    commitments?: {
      finalRoot?: string;
      finalState?: string;
    };
  };
  ironwood?: {
    commitments?: {
      finalRoot?: string;
      finalState?: string;
    };
  };
}

export class JsonRpcVerifier {
  public readonly rawUrl: string;
  public readonly safeUrl: string;
  private reqId: number = 0;
  private requestCounter: number = 0;
  public lastHeaders: Record<string, string> = {};

  constructor(url: string) {
    this.rawUrl = url;
    this.safeUrl = JsonRpcVerifier.redactUrl(url);
  }

  public static redactUrl(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      return `${u.protocol}//<redacted>/<redacted>`;
    } catch {
      return '<redacted>';
    }
  }

  public getRequestCount(): number {
    return this.requestCounter;
  }

  public async call<T>(method: string, params: any[] = []): Promise<T> {
    this.requestCounter++;
    this.reqId++;
    const body = JSON.stringify({
      jsonrpc: '1.0',
      id: `sdk-${this.reqId}`,
      method,
      params,
    });

    const u = new URL(this.rawUrl);
    const fetchHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (u.username || u.password) {
      const auth = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
      const encoded =
        typeof Buffer !== 'undefined'
          ? Buffer.from(auth).toString('base64')
          : btoa(auth);
      fetchHeaders['Authorization'] = `Basic ${encoded}`;
      u.username = '';
      u.password = '';
    }

    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: fetchHeaders,
      body,
    });

    // Capture rate-limit / credit headers if present
    const headers: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      const lk = key.toLowerCase();
      if (
        lk.includes('ratelimit') ||
        lk.includes('credit') ||
        lk.includes('quota') ||
        lk.includes('remaining') ||
        lk.includes('limit')
      ) {
        headers[lk] = val;
      }
    });
    this.lastHeaders = headers;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `[${this.safeUrl}] (third-party server) HTTP ${res.status} ${res.statusText}: ${text}`
      );
    }

    const data = (await res.json()) as JsonRpcResponse<T>;
    if (data.error) {
      throw new Error(
        `[${this.safeUrl}] (third-party server) RPC Error (${data.error.code}): ${data.error.message}`
      );
    }

    return data.result;
  }

  public async getBlockchainInfo(): Promise<JsonRpcBlockchainInfo> {
    return this.call<JsonRpcBlockchainInfo>('getblockchaininfo', []);
  }

  public async getBlockHash(height: number): Promise<string> {
    return this.call<string>('getblockhash', [height]);
  }

  public async getTreeState(heightOrHash: number | string): Promise<JsonRpcTreeState> {
    return this.call<JsonRpcTreeState>('z_gettreestate', [String(heightOrHash)]);
  }

  public async getRawTransaction(txid: string, verbose: number = 1): Promise<any> {
    return this.call<any>('getrawtransaction', [txid, verbose]);
  }
}
