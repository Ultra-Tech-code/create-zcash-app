/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import {
  createColors,
  formatTimestamp,
  formatZatoshis,
  formatZec,
  padLeft,
  padRight,
  shouldColor,
  toZatoshis,
} from './format';
import { FormatOptions, RawTransaction } from './types';

export interface TxFormatExtra {
  subsidyZat?: bigint | null;
  transparentInputsTotalZat?: bigint | null;
  transparentInputsUnresolved?: boolean;
}

export interface ParsedTxDetails {
  txid: string;
  isCoinbase: boolean;
  isMempool: boolean;
  height?: number;
  confirmations: number;
  blockhash?: string;
  timestamp: string;
  pools: string[];
  transferCount: number;
  transparentInputsCount: number;
  transparentOutputsCount: number;
  transparentOutputTotalZat: bigint;
  sproutJoinsplitsCount: number;
  sproutValueBalanceZat: bigint;
  saplingSpendsCount: number;
  saplingOutputsCount: number;
  saplingValueBalanceZat: bigint;
  orchardActionsCount: number;
  orchardValueBalanceZat: bigint;
  ironwoodActionsCount: number;
  ironwoodValueBalanceZat: bigint;
  feeZat?: bigint;
  feeDisplay: string;
}

export function parseTxDetails(
  tx: RawTransaction,
  extra?: TxFormatExtra,
  options?: FormatOptions
): ParsedTxDetails {
  const isCoinbase = Boolean(tx.vin && tx.vin.length > 0 && tx.vin.some((v) => Boolean(v.coinbase)));
  const isMempool = !tx.confirmations || tx.confirmations <= 0 || tx.height === undefined;
  const confirmations = tx.confirmations ?? 0;
  const height = tx.height;
  const blockhash = tx.blockhash;

  const rawTime = tx.time ?? tx.blocktime;
  const timestamp = rawTime ? formatTimestamp(rawTime, options?.local) : (isMempool ? 'In mempool' : 'n/a');

  // Transparent
  const transparentInputsCount = tx.vin ? tx.vin.length : 0;
  const transparentOutputsCount = tx.vout ? tx.vout.length : 0;
  let transparentOutputTotalZat = 0n;
  if (Array.isArray(tx.vout)) {
    for (const out of tx.vout) {
      transparentOutputTotalZat += toZatoshis(out.valueZat, out.value);
    }
  }

  // Sprout
  const sproutJoinsplitsCount = Array.isArray(tx.vjoinsplit) ? tx.vjoinsplit.length : 0;
  let sproutValueBalanceZat = 0n;
  if (Array.isArray(tx.vjoinsplit) && tx.vjoinsplit.length > 0) {
    for (const js of tx.vjoinsplit) {
      const vpubOld = toZatoshis(js.vpub_oldZat, js.vpub_old);
      const vpubNew = toZatoshis(js.vpub_newZat, js.vpub_new);
      sproutValueBalanceZat += vpubOld - vpubNew;
    }
  }

  // Sapling
  const saplingSpendsCount = Array.isArray(tx.vShieldedSpend) ? tx.vShieldedSpend.length : 0;
  const saplingOutputsCount = Array.isArray(tx.vShieldedOutput) ? tx.vShieldedOutput.length : 0;
  const saplingValueBalanceZat = toZatoshis(tx.valueBalanceZat, tx.valueBalance);

  // Orchard
  const orchardActionsCount = Array.isArray(tx.orchard?.actions) ? tx.orchard!.actions!.length : 0;
  const orchardValueBalanceZat = toZatoshis(tx.orchard?.valueBalanceZat, tx.orchard?.valueBalance);

  // Ironwood (NU7)
  const ironwoodActionsCount = Array.isArray(tx.ironwood?.actions) ? tx.ironwood!.actions!.length : 0;
  const ironwoodValueBalanceZat = toZatoshis(tx.ironwood?.valueBalanceZat, tx.ironwood?.valueBalance);

  // Pool classification
  const pools: string[] = [];
  const hasTransparent =
    (!isCoinbase && transparentInputsCount > 0) || transparentOutputsCount > 0;
  if (hasTransparent) pools.push('Transparent');
  if (sproutJoinsplitsCount > 0) pools.push('Sprout');
  if (saplingSpendsCount > 0 || saplingOutputsCount > 0 || saplingValueBalanceZat !== 0n) {
    pools.push('Sapling');
  }
  if (orchardActionsCount > 0 || orchardValueBalanceZat !== 0n) {
    pools.push('Orchard');
  }
  if (ironwoodActionsCount > 0 || ironwoodValueBalanceZat !== 0n) {
    pools.push('Ironwood');
  }

  const transferCount =
    transparentOutputsCount + saplingOutputsCount + orchardActionsCount + ironwoodActionsCount;

  // Fee calculation (Rule 5)
  // Transparent inputs - transparent outputs + valueBalanceSapling + valueBalanceOrchard + valueBalanceIronwood
  let feeZat: bigint | undefined;
  let feeDisplay = 'fee: n/a';

  if (isCoinbase) {
    // For coinbases: compute fee as subsidy - outputs, where subsidy comes from getblocksubsidy
    if (extra?.subsidyZat !== undefined && extra.subsidyZat !== null) {
      // Total coinbase outputs = transparent outputs + (-valueBalance for each shielded pool)
      const shieldedOutputsZat =
        (-saplingValueBalanceZat) + (-orchardValueBalanceZat) + (-ironwoodValueBalanceZat);
      const totalOutputsZat = transparentOutputTotalZat + shieldedOutputsZat;
      feeZat = extra.subsidyZat - totalOutputsZat;
      feeDisplay = `${formatZec(feeZat)} ZEC (${formatZatoshis(feeZat)} zatoshis)`;
    } else {
      feeDisplay = 'fee: n/a (coinbase subsidy not provided)';
    }
  } else {
    // Normal transaction
    const hasTransparentInputs = tx.vin && tx.vin.length > 0;
    if (hasTransparentInputs) {
      if (
        extra?.transparentInputsUnresolved ||
        extra?.transparentInputsTotalZat === undefined ||
        extra?.transparentInputsTotalZat === null
      ) {
        feeDisplay = 'fee: n/a (transparent inputs not resolved)';
      } else {
        const netShielded =
          sproutValueBalanceZat +
          saplingValueBalanceZat +
          orchardValueBalanceZat +
          ironwoodValueBalanceZat;
        feeZat =
          extra.transparentInputsTotalZat - transparentOutputTotalZat + netShielded;
        feeDisplay = `${formatZec(feeZat)} ZEC (${formatZatoshis(feeZat)} zatoshis)`;
      }
    } else {
      // Pure shielded
      const netShielded =
        sproutValueBalanceZat +
        saplingValueBalanceZat +
        orchardValueBalanceZat +
        ironwoodValueBalanceZat;
      feeZat = 0n - transparentOutputTotalZat + netShielded;
      feeDisplay = `${formatZec(feeZat)} ZEC (${formatZatoshis(feeZat)} zatoshis)`;
    }
  }

  return {
    txid: tx.txid,
    isCoinbase,
    isMempool,
    height,
    confirmations,
    blockhash,
    timestamp,
    pools,
    transferCount,
    transparentInputsCount,
    transparentOutputsCount,
    transparentOutputTotalZat,
    sproutJoinsplitsCount,
    sproutValueBalanceZat,
    saplingSpendsCount,
    saplingOutputsCount,
    saplingValueBalanceZat,
    orchardActionsCount,
    orchardValueBalanceZat,
    ironwoodActionsCount,
    ironwoodValueBalanceZat,
    feeZat,
    feeDisplay,
  };
}

export function formatTx(
  tx: RawTransaction,
  extra?: TxFormatExtra,
  options?: FormatOptions
): string {
  const c = createColors(shouldColor(options));
  const parsed = parseTxDetails(tx, extra, options);
  const lines: string[] = [];

  lines.push(`${c.bold('Transaction ID:')} ${c.cyan(parsed.txid)}`);

  if (parsed.isMempool) {
    lines.push(`${c.bold('Status:')}         ${c.yellow('In mempool (0 confirmations)')}`);
  } else {
    const confStr = `${parsed.confirmations} confirmation${parsed.confirmations === 1 ? '' : 's'}`;
    lines.push(
      `${c.bold('Status:')}         ${c.green(`Mined in block ${parsed.height}`)} (${c.dim(confStr)})`
    );
    if (parsed.blockhash) {
      lines.push(`${c.bold('Block Hash:')}     ${c.dim(parsed.blockhash)}`);
    }
  }

  lines.push(
    `${c.bold('Timestamp:')}      ${parsed.timestamp} ${
      options?.local && !parsed.isMempool ? c.dim('(local)') : !parsed.isMempool ? c.dim('(UTC)') : ''
    }`
  );

  const txType = parsed.isCoinbase ? c.yellow('Coinbase') : 'Standard';
  const overwintered = tx.overwintered ? ', Overwintered' : '';
  lines.push(`${c.bold('Type:')}           ${txType} (Version ${tx.version}${overwintered})`);
  lines.push(`${c.bold('Pools:')}          ${c.magenta(parsed.pools.join(', ') || 'None')}`);
  lines.push(`${c.bold('Fee:')}            ${c.green(parsed.feeDisplay)}`);

  // Breakdown section
  lines.push('');
  lines.push(c.bold('Pool Details:'));
  lines.push('─'.repeat(74));

  // Transparent details
  if (parsed.isCoinbase) {
    lines.push(
      `  ${c.bold('Transparent:')}    ${c.yellow('coinbase input')}, ${parsed.transparentOutputsCount} output(s) ` +
        `(${formatZec(parsed.transparentOutputTotalZat)} ZEC)`
    );
  } else if (parsed.transparentInputsCount > 0 || parsed.transparentOutputsCount > 0) {
    lines.push(
      `  ${c.bold('Transparent:')}    ${parsed.transparentInputsCount} input(s), ${parsed.transparentOutputsCount} output(s) ` +
        `(${formatZec(parsed.transparentOutputTotalZat)} ZEC)`
    );
  }

  // Sprout
  if (parsed.sproutJoinsplitsCount > 0) {
    lines.push(`  ${c.bold('Sprout:')}         ${parsed.sproutJoinsplitsCount} joinsplit(s)`);
  }

  // Sapling
  if (
    parsed.saplingSpendsCount > 0 ||
    parsed.saplingOutputsCount > 0 ||
    parsed.saplingValueBalanceZat !== 0n
  ) {
    const sign = parsed.saplingValueBalanceZat > 0n ? '+' : '';
    lines.push(
      `  ${c.bold('Sapling:')}        ${parsed.saplingSpendsCount} spend(s), ${parsed.saplingOutputsCount} output(s), ` +
        `value balance: ${sign}${formatZec(parsed.saplingValueBalanceZat)} ZEC ` +
        `(${c.dim(sign + formatZatoshis(parsed.saplingValueBalanceZat) + ' zatoshis')})`
    );
  }

  // Orchard
  if (parsed.orchardActionsCount > 0 || parsed.orchardValueBalanceZat !== 0n) {
    const sign = parsed.orchardValueBalanceZat > 0n ? '+' : '';
    lines.push(
      `  ${c.bold('Orchard:')}        ${parsed.orchardActionsCount} action(s), ` +
        `value balance: ${sign}${formatZec(parsed.orchardValueBalanceZat)} ZEC ` +
        `(${c.dim(sign + formatZatoshis(parsed.orchardValueBalanceZat) + ' zatoshis')})`
    );
  }

  // Ironwood (NU7)
  if (parsed.ironwoodActionsCount > 0 || parsed.ironwoodValueBalanceZat !== 0n) {
    const sign = parsed.ironwoodValueBalanceZat > 0n ? '+' : '';
    lines.push(
      `  ${c.bold('Ironwood:')}       ${parsed.ironwoodActionsCount} action(s), ` +
        `value balance: ${sign}${formatZec(parsed.ironwoodValueBalanceZat)} ZEC ` +
        `(${c.dim(sign + formatZatoshis(parsed.ironwoodValueBalanceZat) + ' zatoshis')})`
    );
  }

  lines.push('─'.repeat(74));
  return lines.join('\n');
}

/**
 * Single-line transaction summary table row (inspired by tx_type.sh)
 */
export function formatTxSummaryLine(
  tx: RawTransaction,
  extra?: TxFormatExtra,
  options?: FormatOptions
): string {
  const c = createColors(shouldColor(options));
  const parsed = parseTxDetails(tx, extra, options);

  const timeCol = padRight(parsed.timestamp, 22);
  const blockCol = padRight(parsed.height !== undefined ? String(parsed.height) : 'mempool', 8);
  const txidCol = padRight(parsed.txid.slice(0, 16) + '...', 20);
  const transfersCol = padRight(String(parsed.transferCount), 6);
  const feeCol = padRight(parsed.feeZat !== undefined ? `${formatZec(parsed.feeZat)} ZEC` : 'n/a', 16);
  const poolsCol = padRight(parsed.pools.join(','), 22);
  const coinbaseCol = parsed.isCoinbase ? c.yellow('Coinbase') : c.dim('Standard');

  return (
    `${c.dim(timeCol)} | ` +
    `${c.yellow(blockCol)} | ` +
    `${c.cyan(txidCol)} | ` +
    `${c.white(transfersCol)} | ` +
    `${c.green(feeCol)} | ` +
    `${c.magenta(poolsCol)} | ` +
    `${coinbaseCol}`
  );
}

