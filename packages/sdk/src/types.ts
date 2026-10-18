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
  getTransparentAddress?(): string;
  birthdayHeight?: number;
  network: Network;
  readonly spendHandle: number;
}

export interface WatchOnlyAccount {
  getUnifiedFullViewingKey(): Ufvk;
  getUnifiedAddress(diversifierIndex?: number): string;
  getTransparentAddress?(): string;
  birthdayHeight?: number;
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
  nullifier?: string;
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
