import { decodeTransaction } from './decrypted-tx.js';
import { reverseTxid } from './send.js';
import type { DecodedTransaction } from './types.js';

export type QueryKind = 'height' | 'hash_or_txid' | 'empty' | 'invalid';

export interface ClassifiedQuery {
  kind: QueryKind;
  cleanQuery: string;
  isAmbiguousHash?: boolean;
  error?: string;
}

/**
 * Classifies an explorer search box input:
 * - Digits: block height
 * - 64-hex: txid or block hash (ambiguous when starting with leading zeros 0000...)
 * - Other: invalid format
 */
export function classifyExplorerQuery(input: string): ClassifiedQuery {
  const cleanQuery = (input || '').trim();
  if (!cleanQuery) {
    return {
      kind: 'empty',
      cleanQuery: '',
      error: 'Enter a search query',
    };
  }

  if (/^\d+$/.test(cleanQuery)) {
    return {
      kind: 'height',
      cleanQuery,
    };
  }

  if (/^[0-9a-fA-F]{64}$/.test(cleanQuery)) {
    const isAmbiguousHash = cleanQuery.toLowerCase().startsWith('0000');
    return {
      kind: 'hash_or_txid',
      cleanQuery: cleanQuery.toLowerCase(),
      isAmbiguousHash,
    };
  }

  return {
    kind: 'invalid',
    cleanQuery,
    error: 'Invalid format: Enter a 64-character transaction ID / block hash or a block height',
  };
}

export { decodeTransaction, reverseTxid };
export type { DecodedTransaction };

