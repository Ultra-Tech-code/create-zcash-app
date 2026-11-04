/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

export interface FormatOptions {
  noColor?: boolean;
  local?: boolean;
}

export interface ValuePool {
  id: string;
  chainValue?: number | string;
  chainValueZat?: number | string | bigint;
  valueDelta?: number | string;
  valueDeltaZat?: number | string | bigint;
  monitored?: boolean;
}

export interface ChainSupply {
  chainValue?: number | string;
  chainValueZat?: number | string | bigint;
  monitored?: boolean;
}

export interface BlockchainInfo {
  chain?: string;
  blocks?: number;
  headers?: number;
  bestblockhash?: string;
  chainSupply?: ChainSupply;
  valuePools?: ValuePool[];
  upgrades?: Record<string, any>;
  consensus?: {
    chaintip?: string;
    nextblock?: string;
  };
  [key: string]: any;
}

export interface BlockCommitmentTrees {
  sapling?: { size: number };
  orchard?: { size: number };
  ironwood?: { size: number };
  [key: string]: { size: number } | undefined;
}

export interface Block {
  hash: string;
  confirmations: number;
  size: number;
  height: number;
  version: number;
  merkleroot: string;
  blockcommitments?: string;
  finalsaplingroot?: string;
  finalorchardroot?: string;
  nTx: number;
  tx: string[];
  time: number;
  chainSupply?: ChainSupply;
  valuePools?: ValuePool[];
  trees?: BlockCommitmentTrees;
  previousblockhash?: string;
  nextblockhash?: string;
  [key: string]: any;
}

export interface RawTransactionVin {
  coinbase?: string;
  txid?: string;
  vout?: number;
  scriptSig?: any;
  sequence?: number;
  valueZat?: number | string | bigint;
  prevout?: {
    valueZat?: number | string | bigint;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface RawTransactionVout {
  value?: number | string;
  valueZat?: number | string | bigint;
  n: number;
  scriptPubKey?: {
    asm?: string;
    hex?: string;
    type?: string;
    addresses?: string[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface ShieldedBundle {
  actions?: any[];
  valueBalance?: number | string;
  valueBalanceZat?: number | string | bigint;
  flags?: any;
  anchor?: string;
  [key: string]: any;
}

export interface RawTransaction {
  txid: string;
  authdigest?: string;
  height?: number;
  confirmations?: number;
  blockhash?: string;
  time?: number;
  blocktime?: number;
  version: number;
  vin?: RawTransactionVin[];
  vout?: RawTransactionVout[];
  vjoinsplit?: any[];
  vShieldedSpend?: any[];
  vShieldedOutput?: any[];
  valueBalance?: number | string;
  valueBalanceZat?: number | string | bigint;
  orchard?: ShieldedBundle;
  ironwood?: ShieldedBundle;
  [key: string]: any;
}

export interface PeerInfo {
  id?: number;
  addr: string;
  addrbind?: string;
  inbound?: boolean;
  conntime?: number;
  version?: number;
  subver?: string;
  [key: string]: any;
}

