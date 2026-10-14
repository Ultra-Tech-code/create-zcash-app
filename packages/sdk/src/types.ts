export type Network = 'regtest' | 'testnet' | 'mainnet';

export interface ClientConfig {
  endpoint: string;
  network: Network;
  transport?: 'grpc' | 'grpc-web';
}

export type Ufvk = string;

export interface Account {
  getUnifiedAddress(diversifierIndex?: number): string;
  getUnifiedFullViewingKey(): Ufvk;
  network: Network;
  readonly spendHandle: number;
}

export interface WatchOnlyAccount {
  getUnifiedFullViewingKey(): Ufvk;
  getUnifiedAddress(diversifierIndex?: number): string;
  network: Network;
}

export interface PoolBalances {
  orchard: bigint;
  ironwood: bigint;
  sapling: bigint;
  transparent: bigint;
  total: bigint;
}

export interface IncomingNote {
  pool: 'orchard' | 'ironwood';
  value: bigint;
  memo?: string;
  txid: string;
  height: number;
  recipient: string;
}

export interface Note extends IncomingNote {
  spent: boolean;
}

export interface SyncResult {
  syncedHeight: number;
  newNotes: IncomingNote[];
  balances: PoolBalances;
}

export interface SendRequest {
  to: string;
  value: bigint;
  memo?: string;
  fromPool?: 'orchard' | 'ironwood';
}

export interface TxResult {
  txid: string;
  fee: bigint;
}
