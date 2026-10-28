export type Network = 'regtest' | 'testnet' | 'mainnet' | 'regtest-nu7';

export type VerificationEndpoint =
  | { kind: 'grpc'; url: string }
  | { kind: 'jsonrpc'; url: string };

export interface ClientConfig {
  endpoint: string;
  network: Network;
  regtestNu7?: boolean;
  transport?: 'grpc' | 'grpc-web';
  tls?: boolean;
  verifyEndpoints?: (string | VerificationEndpoint)[];
}

export type Ufvk = string;

export interface Account {
  getUnifiedAddress(diversifierIndex?: number): string;
  getUnifiedFullViewingKey(): Ufvk;
  getTransparentAddress?(): string | undefined;
  birthdayHeight?: number;
  network: Network;
  readonly spendHandle: number;
}

export interface WatchOnlyAccount {
  getUnifiedFullViewingKey(): Ufvk;
  getUnifiedAddress(diversifierIndex?: number): string;
  getTransparentAddress?(): string | undefined;
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

export interface AccountBalance extends PoolBalances {
  confirmed: PoolBalances;
  pending: PoolBalances;
}

export interface IncomingNote {
  pool: 'orchard' | 'ironwood';
  value: bigint;
  memo?: string;
  txid: string;
  height: number;
  recipient: string;
  nullifier?: string;
  rho?: string;
  rseed?: string;
  cmx?: string;
  treePosition?: number;
}

export interface Note extends IncomingNote {
  spent: boolean;
}

export interface SyncResult {
  syncedHeight: number;
  newNotes: IncomingNote[];
  balances: AccountBalance;
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

export interface DecryptedMemo {
  text?: string;
  hex: string;
}

export interface DecryptedActionIncoming {
  actionIndex: number;
  value: bigint;
  memo: DecryptedMemo;
  recipient: string;
  isChange: boolean;
  isInternal: boolean;
}

export interface DecryptedActionOutgoing {
  actionIndex: number;
  value: bigint;
  memo: DecryptedMemo;
  recipient: string;
}

export interface DecryptedTransaction {
  txid: string;
  fee: bigint | null;
  expiryHeight: number;
  consensusBranchId: string;
  incoming: DecryptedActionIncoming[];
  outgoing: DecryptedActionOutgoing[];
}
