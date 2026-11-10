#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { spawn, execSync } from 'child_process';
import {
  createClient,
  dev,
  accountFromMnemonic,
  accountFromUfvk,
  getBalance,
  quoteFee,
  send,
  syncWallet,
  WalletHandle,
  KNOWN_TEST_MNEMONICS,
} from '@zcash-app/sdk';
import {
  loadProjectEnv,
  applyProjectEnv,
  formatZec,
  parseZecToZatoshis,
} from './env';
import { redactSecretUrl, sanitizeError } from './redact';
import {
  ZebraRpcClient,
  formatSupply,
  formatBlock,
  formatTx,
  formatPeers,
  formatMempool,
  toZatoshis,
} from './pretty';
import {
  readZebraCookie,
  buildTestnetLightwalletdArgs,
  redactLightwalletdArgs,
  TestnetLightwalletdOptions,
} from './testnet-lightwalletd';

export {
  readZebraCookie,
  buildTestnetLightwalletdArgs,
  redactLightwalletdArgs,
  TestnetLightwalletdOptions,
};

/** Reads this package's own version so `zcash-dev --version` cannot drift from package.json. */
export function readOwnVersion(): string {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`Could not read zcash-dev's version from ${packageJsonPath}`);
  }
  return parsed.version;
}

export function getRegtestAccount0MinerAddress(network: string = 'regtest'): string {
  if (network !== 'regtest' && network !== 'regtest-nu7') {
    throw new Error(
      `Security Error: Refusing miner address derivation for non-regtest network "${network}". KNOWN_TEST_MNEMONICS is strictly restricted to regtest.`
    );
  }
  const acct = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, network as any);
  return acct.getUnifiedAddress();
}

const REMOTE_ENDPOINTS: Record<string, string> = {
  regtest: '127.0.0.1:39067',
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};

const program = new Command();

program
  .name('zcash-dev')
  .description('Developer harness & regtest helper CLI for shielded Zcash apps')
  .version(readOwnVersion());

program
  .command('info')
  .description('Get node & indexer status')
  .option('-e, --endpoint <endpoint>', 'Lightwalletd / Zaino gRPC endpoint', '127.0.0.1:39067')
  .option('-n, --network <network>', 'Network (regtest | testnet | mainnet)', 'regtest')
  .option('--nu7', 'Deprecated opt-in to NU7 on regtest (NU7 is now active by default)')
  .action(async (options) => {
    const client = createClient({
      endpoint: options.endpoint,
      network: options.network as any,
      regtestNu7: Boolean(options.nu7),
    });
    try {
      const info = await client.getInfo();
      console.log('\n--- Zcash Node / Indexer Info ---');
      console.log(`Vendor:          ${info.vendor} v${info.version}`);
      console.log(`Chain:           ${info.chainName}`);
      console.log(`Upgrade:         ${info.upgradeName ?? 'N/A'}`);
      console.log(`Consensus Branch: ${info.consensusBranchId}`);
      console.log(`Block Height:    ${info.blockHeight}`);
      console.log(`t-addr Support:  ${info.taddrSupport ? 'Yes' : 'No'}\n`);
    } catch (err: any) {
      console.error('Failed to get info:', err.message || err);
      process.exit(1);
    } finally {
      await client.close();
    }
  });

export interface SendActionOptions {
  to: string;
  amount: string;
  memo?: string;
  yes?: boolean;
  mainnet?: boolean;
  endpoint?: string;
}

export interface SendDependencies {
  client?: any;
  sendFn?: typeof send;
  syncWalletFn?: typeof syncWallet;
  openWalletFn?: typeof WalletHandle.open;
}

export interface SendResult {
  isDryRun: boolean;
  network: string;
  recipient: string;
  amountZatoshis: bigint;
  feeZatoshis: bigint;
  endpoint: string;
  memo?: string;
  txid?: string;
}

export async function executeSend(
  options: SendActionOptions,
  config?: Record<string, string>,
  deps?: SendDependencies
): Promise<SendResult> {
  const env = config ?? loadProjectEnv();
  const network = (env.ZCASH_NETWORK ?? 'regtest').trim().toLowerCase();
  const regtestStack = (env.ZCASH_REGTEST_STACK ?? '').trim().toLowerCase();
  const endpoint = options.endpoint || env.ZCASH_ENDPOINT || REMOTE_ENDPOINTS[network] || '127.0.0.1:39067';
  const isNu7Alias = network === 'regtest-nu7' || regtestStack === 'nu7';
  const effectiveNetwork = isNu7Alias ? 'regtest-nu7' : network;
  const mnemonic = (env.ZCASH_MNEMONIC ?? '').trim();
  const ufvk = (env.ZCASH_UFVK ?? '').trim();
  const accountIndex = parseInt(env.ZCASH_ACCOUNT_INDEX ?? '0', 10) || 0;
  const birthdayRaw = (env.ZCASH_BIRTHDAY ?? '').trim();
  const birthday = /^\d+$/.test(birthdayRaw) ? parseInt(birthdayRaw, 10) : undefined;

  // Reject UFVK-only configs
  if (ufvk && !mnemonic) {
    throw new Error('Cannot send from a watch-only account (UFVK). A spending key (mnemonic) is required.');
  }

  if (!mnemonic && network !== 'regtest') {
    throw new Error(`No spending key (ZCASH_MNEMONIC) configured for ${network}. Cannot send without a spending key.`);
  }

  const amountZatoshis = parseZecToZatoshis(options.amount);
  const feeZatoshis = quoteFee(2);

  // Dry run mode (default when --yes is not set)
  if (!options.yes) {
    return {
      isDryRun: true,
      network,
      recipient: options.to,
      amountZatoshis,
      feeZatoshis,
      endpoint: redactSecretUrl(endpoint),
      memo: options.memo,
    };
  }

  // Broadcast mode (--yes passed)
  if (network === 'mainnet' && !options.mainnet) {
    throw new Error('Sending on mainnet requires the explicit --mainnet flag.');
  }

  const activeMnemonic = mnemonic || (network === 'regtest' ? KNOWN_TEST_MNEMONICS[accountIndex] || KNOWN_TEST_MNEMONICS[0] : '');
  const account = accountFromMnemonic(activeMnemonic, accountIndex, effectiveNetwork as any);

  const client = deps?.client ?? createClient({ endpoint, network: effectiveNetwork as any });
  const openFn = deps?.openWalletFn ?? ((...args: Parameters<typeof WalletHandle.open>) => WalletHandle.open(...args));
  const syncFn = deps?.syncWalletFn ?? syncWallet;
  const sendFn = deps?.sendFn ?? send;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-wallet-'));
  const dbPath = path.join(tempDir, 'wallet.db');

  let result;
  try {
    const wallet = openFn(
      dbPath,
      effectiveNetwork as any,
      account.getUnifiedFullViewingKey(),
      `acct${accountIndex}`,
      birthday
    );
    await syncFn(client, wallet);
    result = await sendFn({
      client,
      wallet,
      from: account,
      to: options.to,
      amount: amountZatoshis,
      memo: options.memo,
    });
  } finally {
    if (!deps?.client) {
      await client.close().catch(() => {});
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  return {
    isDryRun: false,
    network,
    recipient: options.to,
    amountZatoshis,
    feeZatoshis: result.fee ? BigInt(result.fee) : feeZatoshis,
    endpoint: redactSecretUrl(endpoint),
    memo: options.memo,
    txid: result.txid,
  };
}

program
  .command('address')
  .description('Display the derived address for the configured account')
  .option('-i, --index <n>', 'Account index')
  .action((options) => {
    try {
      applyProjectEnv();
      const network = (process.env.ZCASH_NETWORK ?? 'regtest').trim().toLowerCase();
      const regtestStack = (process.env.ZCASH_REGTEST_STACK ?? '').trim().toLowerCase();
      const endpoint = process.env.ZCASH_ENDPOINT ?? '';
      const isNu7Alias = network === 'regtest-nu7' || regtestStack === 'nu7';
      const effectiveNetwork = isNu7Alias ? 'regtest-nu7' : network;
      const rawIndex = options.index ?? process.env.ZCASH_ACCOUNT_INDEX ?? '0';
      const accountIndex = parseInt(rawIndex, 10) || 0;
      const mnemonic = (process.env.ZCASH_MNEMONIC ?? '').trim();
      const ufvk = (process.env.ZCASH_UFVK ?? '').trim();

      if (!mnemonic && !ufvk) {
        if (network === 'regtest') {
          const acct = dev.fixtures.account(accountIndex, effectiveNetwork as any);
          console.log(`\n--- Configured Account Address ---`);
          console.log(`Network:          ${network}`);
          console.log(`Account Index:    ${accountIndex} (regtest default fixture)`);
          console.log(`Unified Address:  ${acct.getUnifiedAddress()}`);
          const tAddr = acct.getTransparentAddress?.();
          if (tAddr) console.log(`Transparent:      ${tAddr}`);
          console.log('');
          return;
        }
        throw new Error(
          `Neither ZCASH_MNEMONIC nor ZCASH_UFVK is configured for ${network}. Set ZCASH_MNEMONIC or ZCASH_UFVK in .env.local.`
        );
      }

      if (mnemonic) {
        const acct = accountFromMnemonic(mnemonic, accountIndex, effectiveNetwork as any);
        console.log(`\n--- Configured Account Address ---`);
        console.log(`Network:          ${network}`);
        console.log(`Account Index:    ${accountIndex}`);
        console.log(`Unified Address:  ${acct.getUnifiedAddress()}`);
        const tAddr = acct.getTransparentAddress?.();
        if (tAddr) console.log(`Transparent:      ${tAddr}`);
        console.log('');
        return;
      }

      if (ufvk) {
        const watchAcct = accountFromUfvk(ufvk, effectiveNetwork as any);
        console.log(`\n--- Configured Account Address (Watch-Only) ---`);
        console.log(`Network:          ${network}`);
        console.log(`Account Index:    ${accountIndex} (UFVK)`);
        console.log(`Unified Address:  ${watchAcct.getUnifiedAddress()}`);
        const tAddr = watchAcct.getTransparentAddress?.();
        if (tAddr) console.log(`Transparent:      ${tAddr}`);
        console.log('');
        return;
      }
    } catch (err: any) {
      const sanitized = sanitizeError(err, process.env.ZCASH_MNEMONIC);
      console.error('Address derivation failed:', sanitized.message);
      process.exit(1);
    }
  });

program
  .command('balance')
  .description('Check balance for the configured account')
  .option('-e, --endpoint <endpoint>', 'Zaino / lightwalletd gRPC endpoint')
  .action(async (options) => {
    let client: any;
    try {
      applyProjectEnv();
      const network = (process.env.ZCASH_NETWORK ?? 'regtest').trim().toLowerCase();
      const regtestStack = (process.env.ZCASH_REGTEST_STACK ?? '').trim().toLowerCase();
      const endpoint = options.endpoint || process.env.ZCASH_ENDPOINT || REMOTE_ENDPOINTS[network] || '127.0.0.1:39067';
      const isNu7Alias = network === 'regtest-nu7' || regtestStack === 'nu7';
      const effectiveNetwork = isNu7Alias ? 'regtest-nu7' : network;
      const birthdayRaw = (process.env.ZCASH_BIRTHDAY ?? '').trim();
      const birthday = /^\d+$/.test(birthdayRaw) ? parseInt(birthdayRaw, 10) : undefined;
      const accountIndex = parseInt(process.env.ZCASH_ACCOUNT_INDEX ?? '0', 10) || 0;
      const mnemonic = (process.env.ZCASH_MNEMONIC ?? '').trim();
      const ufvk = (process.env.ZCASH_UFVK ?? '').trim();

      let account: any;
      if (mnemonic) {
        account = accountFromMnemonic(mnemonic, accountIndex, effectiveNetwork as any);
      } else if (ufvk) {
        account = accountFromUfvk(ufvk, effectiveNetwork as any);
      } else if (network === 'regtest') {
        account = dev.fixtures.account(accountIndex, effectiveNetwork as any);
      } else {
        throw new Error(
          `Neither ZCASH_MNEMONIC nor ZCASH_UFVK is configured for ${network}. Set ZCASH_MNEMONIC or ZCASH_UFVK in .env.local.`
        );
      }

      console.log(`Querying balance on ${network} via ${redactSecretUrl(endpoint)}...`);
      client = createClient({ endpoint, network: effectiveNetwork as any });
      const b = await getBalance(client, account, { sinceHeight: birthday });
      console.log('\n--- Account Balance ---');
      console.log(`Network:     ${network}`);
      console.log(`Total:       ${formatZec(b.total)} ZEC (${b.total} zatoshis)`);
      console.log(`Ironwood:    ${formatZec(b.ironwood)} ZEC`);
      console.log(`Orchard:     ${formatZec(b.orchard)} ZEC`);
      console.log(`Sapling:     ${formatZec(b.sapling)} ZEC`);
      console.log(`Transparent: ${formatZec(b.transparent)} ZEC`);
      if (b.confirmed && b.pending) {
        console.log(`Confirmed:   ${formatZec(b.confirmed.total)} ZEC`);
        console.log(`Pending:     ${formatZec(b.pending.total)} ZEC`);
      }
      console.log('');
    } catch (err: any) {
      const sanitized = sanitizeError(err, process.env.ZCASH_MNEMONIC);
      console.error('Balance check failed:', sanitized.message);
      process.exit(1);
    } finally {
      if (client) {
        await client.close().catch(() => {});
      }
    }
  });

program
  .command('send')
  .description('Send ZEC or perform a transaction dry run')
  .requiredOption('--to <address>', 'Recipient address (unified, sapling, or transparent)')
  .requiredOption('--amount <zec>', 'Amount to send in ZEC')
  .option('--memo <memo>', 'Optional memo for shielded recipient')
  .option('--yes', 'Broadcast the transaction (without --yes, runs in dry-run mode)')
  .option('--mainnet', 'Safety confirmation flag required when broadcasting on mainnet')
  .option('-e, --endpoint <endpoint>', 'Zaino / lightwalletd gRPC endpoint')
  .action(async (options) => {
    try {
      applyProjectEnv();
      const config = loadProjectEnv();
      const res = await executeSend(options, config);
      if (res.isDryRun) {
        console.log('\n=== Transaction Dry Run ===');
        console.log(`Network:   ${res.network}`);
        console.log(`Recipient: ${res.recipient}`);
        console.log(`Amount:    ${options.amount} ZEC (${res.amountZatoshis} zatoshis)`);
        console.log(`Fee:       ${formatZec(res.feeZatoshis)} ZEC (${res.feeZatoshis} zatoshis) [estimated (ZIP-317, 2 outputs assumed)]`);
        console.log(`Endpoint:  ${res.endpoint}`);
        if (res.memo) {
          console.log(`Memo:      ${res.memo}`);
        }
        console.log('Status:    DRY RUN ONLY — transaction was NOT broadcast.');
        console.log(`Pass --yes to sign and broadcast this transaction${res.network === 'mainnet' ? ' (requires --mainnet)' : ''}.\n`);
      } else {
        console.log('\n✅ Transaction broadcast successfully!');
        console.log(`Txid:      ${res.txid}`);
        console.log(`Fee:       ${formatZec(res.feeZatoshis)} ZEC (${res.feeZatoshis} zatoshis)\n`);
      }
    } catch (err: any) {
      const sanitized = sanitizeError(err, process.env.ZCASH_MNEMONIC);
      console.error('Send failed:', sanitized.message);
      process.exit(1);
    }
  });

export interface FundActionOptions {
  address: string;
  amount: string;
  endpoint?: string;
  stack?: string;
}

export interface FundDependencies {
  client?: any;
  sendFn?: typeof send;
  syncWalletFn?: typeof syncWallet;
  openWalletFn?: typeof WalletHandle.open;
  fetchFn?: typeof fetch;
}

export interface FundResult {
  txid: string;
  stack: 'lightwalletd' | 'zaino' | 'full' | string;
  recipient: string;
  amountZec: string;
  zatoshis: bigint;
  endpoint: string;
}

export async function executeFund(
  options: FundActionOptions,
  config?: Record<string, string>,
  deps?: FundDependencies
): Promise<FundResult> {
  const env = config ?? loadProjectEnv();
  const network = (env.ZCASH_NETWORK ?? 'regtest').trim().toLowerCase();
  if (network !== 'regtest' && network !== 'regtest-nu7') {
    throw new Error(`Fund is only available on regtest (current network: ${network}).`);
  }

  let stack = (options.stack || env.ZCASH_REGTEST_STACK || '').trim().toLowerCase();
  const endpointOpt = options.endpoint || env.ZCASH_ENDPOINT;
  if (!stack) {
    if (endpointOpt && endpointOpt.includes('38137')) {
      stack = 'zaino';
    } else {
      stack = 'lightwalletd';
    }
  }

  if (stack === 'nu7') {
    stack = 'lightwalletd';
  }

  if (stack === 'z3' || stack === 'nu6') {
    throw new Error(
      'The Z3 / NU6 stack has been removed in 0.1.0-alpha.5. Available stacks: lightwalletd (default), zaino (experimental), full.'
    );
  }

  if (stack !== 'lightwalletd' && stack !== 'zaino' && stack !== 'full') {
    throw new Error(`Invalid regtest stack "${stack}". Must be "lightwalletd", "zaino", or "full".`);
  }

  const zatoshis = parseZecToZatoshis(options.amount);

  const defaultPort = stack === 'zaino' ? '38137' : '39067';
  const effectiveEndpoint = options.endpoint || env.ZCASH_ENDPOINT || `127.0.0.1:${defaultPort}`;
  const minerAccount = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const client = deps?.client ?? createClient({ endpoint: effectiveEndpoint, network: 'regtest' });
  const openFn = deps?.openWalletFn ?? ((...args: Parameters<typeof WalletHandle.open>) => WalletHandle.open(...args));
  const syncFn = deps?.syncWalletFn ?? syncWallet;
  const sendFn = deps?.sendFn ?? send;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-fund-'));
  const dbPath = path.join(tempDir, 'wallet.db');
  let result;
  try {
    const wallet = openFn(
      dbPath,
      'regtest',
      minerAccount.getUnifiedFullViewingKey(),
      'miner0',
      0
    );
    await syncFn(client, wallet);
    result = await sendFn({
      client,
      wallet,
      from: minerAccount,
      to: options.address,
      amount: zatoshis,
    });
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('UNAVAILABLE') || msg.includes('connect')) {
      throw new Error(
        `Could not connect to ${stack} indexer at ${redactSecretUrl(effectiveEndpoint)}. Is the ${stack} stack running? Run: zcash-dev regtest up --stack ${stack} (${msg})`
      );
    }
    throw err;
  } finally {
    if (!deps?.client) {
      await client.close().catch(() => {});
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  return {
    txid: result.txid,
    stack,
    recipient: options.address,
    amountZec: options.amount,
    zatoshis,
    endpoint: redactSecretUrl(effectiveEndpoint),
  };
}

program
  .command('mine')
  .description('Mine blocks on regtest')
  .argument('[blocks]', 'Number of blocks to mine', '1')
  .option('-e, --endpoint <endpoint>', 'Zebra RPC endpoint')
  .option('--stack <stack>', 'Regtest stack (lightwalletd | zaino | full)')
  .action(async (blocksStr, options) => {
    try {
      applyProjectEnv();
      const env = loadProjectEnv();
      const blocks = parseInt(blocksStr, 10);
      let stack = (options.stack || env.ZCASH_REGTEST_STACK || '').trim().toLowerCase();
      if (stack === 'nu7') stack = 'lightwalletd';
      if (stack === 'z3' || stack === 'nu6') {
        throw new Error(
          'The Z3 / NU6 stack has been removed in 0.1.0-alpha.5. Available stacks: lightwalletd (default), zaino (experimental), full.'
        );
      }
      if (!stack) stack = 'lightwalletd';

      const zebraRpcOpt = env.ZCASH_ZEBRA_RPC;
      const zebraUrl =
        options.endpoint && options.endpoint.startsWith('http')
          ? options.endpoint
          : zebraRpcOpt || 'http://127.0.0.1:39232';

      console.log(`Mining ${blocks} block(s) on ${stack.toUpperCase()} regtest stack...`);
      let res;
      try {
        res = await fetch(zebraUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'zcash-dev-mine',
            method: 'generate',
            params: [blocks],
          }),
        });
      } catch (err: any) {
        throw new Error(
          `Could not connect to Zebra JSON-RPC at ${zebraUrl}. Is the ${stack} stack running? Run: zcash-dev regtest up --stack ${stack} (${err.message})`
        );
      }
      if (!res.ok) {
        throw new Error(`Zebra mining HTTP ${res.status}: ${res.statusText}`);
      }
      const data: any = await res.json();
      if (data.error) {
        throw new Error(`Zebra mining JSON-RPC error: ${data.error.message || JSON.stringify(data.error)}`);
      }
      console.log(`✅ Successfully mined ${blocks} block(s) on Zebra.`);
    } catch (err: any) {
      console.error('Mining failed:', err.message || err);
      process.exit(1);
    }
  });

program
  .command('fund')
  .description('Fund a Unified Address on regtest')
  .argument('<address>', 'Recipient Unified Address')
  .argument('[amount]', 'Amount in ZEC', '1.0')
  .option('-e, --endpoint <endpoint>', 'Lightwalletd / Zaino gRPC endpoint')
  .option('--stack <stack>', 'Regtest stack (lightwalletd | zaino | full)')
  .action(async (address, amountStr, options) => {
    try {
      applyProjectEnv();
      const config = loadProjectEnv();
      const res = await executeFund(
        { address, amount: amountStr, endpoint: options.endpoint, stack: options.stack },
        config
      );
      console.log(`\n✅ Funded successfully via ${res.stack.toUpperCase()} stack!`);
      console.log(`Recipient: ${res.recipient}`);
      console.log(`Amount:    ${res.amountZec} ZEC (${res.zatoshis} zatoshis)`);
      console.log(`Txid:      ${res.txid}\n`);
    } catch (err: any) {
      const sanitized = sanitizeError(err, process.env.ZCASH_MNEMONIC);
      console.error('Funding failed:', sanitized.message);
      process.exit(1);
    }
  });

program
  .command('fixtures')
  .description('Display deterministic fixture accounts')
  .option('-n, --network <network>', 'Network (regtest | testnet)', 'regtest')
  .action((options) => {
    console.log(`\n--- Fixture Accounts (${options.network}) ---`);
    for (let i = 0; i < dev.fixtures.mnemonics.length; i++) {
      const acct = dev.fixtures.account(i, options.network as any);
      console.log(`[Account #${i}]`);
      console.log(`UA:   ${acct.getUnifiedAddress()}`);
      console.log(`UFVK: ${acct.getUnifiedFullViewingKey()}`);
      console.log();
    }
  });

function parseRpcParam(val: string): any {
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

program
  .command('rpc <method> [params...]')
  .description('Execute raw JSON-RPC call to Zebra')
  .option('--pretty', 'Display human-readable pretty output for known methods')
  .option('--json', 'Output raw result as JSON (default)')
  .option('--no-color', 'Disable ANSI colors')
  .option('--local', 'Format timestamps in local timezone instead of UTC')
  .option('-e, --zebra-rpc <endpoint>', 'Zebra RPC endpoint URL')
  .action(async (method, rawParams = [], options) => {
    try {
      applyProjectEnv();
      const client = new ZebraRpcClient({ endpoint: options.zebraRpc });
      let params = (rawParams || []).map(parseRpcParam);

      // Special handling for getblock where Zebra expects string for param[0]
      if (method.toLowerCase() === 'getblock' && params.length > 0 && typeof params[0] === 'number') {
        params[0] = String(params[0]);
      }

      const result = await client.call(method, params);

      if (options.pretty) {
        const lower = method.toLowerCase();
        if (lower === 'getblockchaininfo') {
          console.log(formatSupply(result, options));
        } else if (lower === 'getblock') {
          console.log(formatBlock(result, options));
        } else if (lower === 'getrawtransaction') {
          let subsidyZat: bigint | null = null;
          if (result.height !== undefined && result.vin?.some((v: any) => v.coinbase)) {
            try {
              const subsidy = await client.call('getblocksubsidy', [result.height]);
              subsidyZat = toZatoshis(undefined, subsidy.totalblocksubsidy);
            } catch {
              // Ignore subsidy resolution failure
            }
          }
          console.log(formatTx(result, { subsidyZat }, options));
        } else if (lower === 'getpeerinfo') {
          console.log(formatPeers(result, options));
        } else if (lower === 'getrawmempool') {
          console.log(formatMempool(result, options));
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        // Default output: raw JSON result
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err: any) {
      const sanitized = sanitizeError(err);
      console.error(sanitized.message);
      process.exit(1);
    }
  });

program
  .command('tx <txid>')
  .description('Inspect transaction details with human-readable pool and fee breakdown')
  .option('--json', 'Output raw transaction JSON')
  .option('--no-color', 'Disable ANSI colors')
  .option('--local', 'Format timestamps in local timezone instead of UTC')
  .option('-e, --zebra-rpc <endpoint>', 'Zebra RPC endpoint URL')
  .action(async (txid, options) => {
    try {
      applyProjectEnv();
      const client = new ZebraRpcClient({ endpoint: options.zebraRpc });
      const tx = await client.call('getrawtransaction', [txid, 1]);

      if (options.json) {
        console.log(JSON.stringify(tx, null, 2));
        return;
      }

      let subsidyZat: bigint | null = null;
      let transparentInputsTotalZat: bigint | null = null;
      let transparentInputsUnresolved = false;

      const isCoinbase = Boolean(tx.vin && tx.vin.length > 0 && tx.vin.some((v: any) => v.coinbase));
      if (isCoinbase) {
        if (tx.height !== undefined) {
          try {
            const subsidyRes = await client.call('getblocksubsidy', [tx.height]);
            subsidyZat = toZatoshis(undefined, subsidyRes.totalblocksubsidy);
          } catch {
            // Unresolved subsidy
          }
        }
      } else if (tx.vin && tx.vin.length > 0) {
        let total = 0n;
        for (const vin of tx.vin) {
          if (vin.valueZat !== undefined) {
            total += toZatoshis(vin.valueZat, vin.value);
          } else if (vin.prevout?.valueZat !== undefined) {
            total += toZatoshis(vin.prevout.valueZat, vin.prevout.value);
          } else if (vin.txid && vin.vout !== undefined) {
            try {
              const prevTx = await client.call('getrawtransaction', [vin.txid, 1]);
              const prevOut = prevTx.vout?.[vin.vout];
              if (prevOut) {
                total += toZatoshis(prevOut.valueZat, prevOut.value);
              } else {
                transparentInputsUnresolved = true;
                break;
              }
            } catch {
              transparentInputsUnresolved = true;
              break;
            }
          } else {
            transparentInputsUnresolved = true;
            break;
          }
        }
        if (!transparentInputsUnresolved) {
          transparentInputsTotalZat = total;
        }
      }

      console.log(
        formatTx(
          tx,
          {
            subsidyZat,
            transparentInputsTotalZat,
            transparentInputsUnresolved,
          },
          options
        )
      );
    } catch (err: any) {
      const sanitized = sanitizeError(err);
      console.error(sanitized.message);
      process.exit(1);
    }
  });

program
  .command('block <heightOrHash>')
  .description('Inspect block details, chain supply, value pool deltas and commitment trees')
  .option('--json', 'Output raw block JSON')
  .option('--no-color', 'Disable ANSI colors')
  .option('--local', 'Format timestamps in local timezone instead of UTC')
  .option('-e, --zebra-rpc <endpoint>', 'Zebra RPC endpoint URL')
  .action(async (heightOrHash, options) => {
    try {
      applyProjectEnv();
      const client = new ZebraRpcClient({ endpoint: options.zebraRpc });
      const block = await client.call('getblock', [String(heightOrHash), 1]);

      if (options.json) {
        console.log(JSON.stringify(block, null, 2));
      } else {
        console.log(formatBlock(block, options));
      }
    } catch (err: any) {
      const sanitized = sanitizeError(err);
      console.error(sanitized.message);
      process.exit(1);
    }
  });

program
  .command('supply')
  .description('Display chain coin supply and value pool breakdown')
  .option('--json', 'Output raw getblockchaininfo JSON')
  .option('--no-color', 'Disable ANSI colors')
  .option('-e, --zebra-rpc <endpoint>', 'Zebra RPC endpoint URL')
  .action(async (options) => {
    try {
      applyProjectEnv();
      const client = new ZebraRpcClient({ endpoint: options.zebraRpc });
      const bci = await client.call('getblockchaininfo', []);

      if (options.json) {
        console.log(JSON.stringify(bci, null, 2));
      } else {
        console.log(formatSupply(bci, options));
      }
    } catch (err: any) {
      const sanitized = sanitizeError(err);
      console.error(sanitized.message);
      process.exit(1);
    }
  });

program
  .command('peers')
  .description('Display connected Zebra peer details and count')
  .option('--json', 'Output raw getpeerinfo JSON')
  .option('--no-color', 'Disable ANSI colors')
  .option('-e, --zebra-rpc <endpoint>', 'Zebra RPC endpoint URL')
  .action(async (options) => {
    try {
      applyProjectEnv();
      const client = new ZebraRpcClient({ endpoint: options.zebraRpc });
      const peers = await client.call('getpeerinfo', []);

      if (options.json) {
        console.log(JSON.stringify(peers, null, 2));
      } else {
        console.log(formatPeers(peers, options));
      }
    } catch (err: any) {
      const sanitized = sanitizeError(err);
      console.error(sanitized.message);
      process.exit(1);
    }
  });

program
  .command('mempool')
  .description('Display Zebra mempool transaction count and IDs')
  .option('--json', 'Output raw getrawmempool JSON')
  .option('--no-color', 'Disable ANSI colors')
  .option('-e, --zebra-rpc <endpoint>', 'Zebra RPC endpoint URL')
  .action(async (options) => {
    try {
      applyProjectEnv();
      const client = new ZebraRpcClient({ endpoint: options.zebraRpc });
      const mempool = await client.call('getrawmempool', []);

      if (options.json) {
        console.log(JSON.stringify(mempool, null, 2));
      } else {
        console.log(formatMempool(mempool, options));
      }
    } catch (err: any) {
      const sanitized = sanitizeError(err);
      console.error(sanitized.message);
      process.exit(1);
    }
  });

program
  .command('switch')
  .description('Switch project network (regtest | testnet | mainnet)')
  .argument('[target-network]', 'Target network: regtest, testnet, or mainnet')
  .option('--remote', 'Use remote public indexer')
  .option('--local', 'Use local Z3 node on 127.0.0.1:8137')
  .action(async (targetNetworkArg, options) => {
    let targetNetwork = targetNetworkArg;

    if (!targetNetwork) {
      const response = await prompts({
        type: 'select',
        name: 'network',
        message: 'Select target network to switch to:',
        choices: [
          { title: '🟢 regtest (Local offline devnet with instant blocks & faucet)', value: 'regtest' },
          { title: '🔵 testnet (Public testnet staging)', value: 'testnet' },
          { title: '🟠 mainnet (Production real ZEC)', value: 'mainnet' },
        ],
      });
      targetNetwork = response.network;
    }

    if (!targetNetwork || !['regtest', 'testnet', 'mainnet'].includes(targetNetwork)) {
      console.error('Invalid network specified. Choose regtest, testnet, or mainnet.');
      process.exit(1);
    }

    let connectionMode: 'local' | 'remote' = 'local';
    let endpoint = '127.0.0.1:39067';

    if (targetNetwork === 'regtest') {
      connectionMode = 'local';
      endpoint = '127.0.0.1:39067';
    } else {
      if (options.remote) {
        connectionMode = 'remote';
        endpoint = REMOTE_ENDPOINTS[targetNetwork];
      } else if (options.local) {
        connectionMode = 'local';
        endpoint = '127.0.0.1:39167';
      } else {
        const modeResponse = await prompts({
          type: 'select',
          name: 'mode',
          message: `How do you want to connect to ${targetNetwork}?`,
          choices: [
            {
              title: `🌐 Remote Public Indexer (${REMOTE_ENDPOINTS[targetNetwork]}) — No node required`,
              value: 'remote',
            },
            {
              title: `🐳 Local Testnet Node (127.0.0.1:39167) — Self-hosted node`,
              value: 'local',
            },
          ],
          initial: 0,
        });
        connectionMode = modeResponse.mode;
        endpoint = connectionMode === 'remote' ? REMOTE_ENDPOINTS[targetNetwork] : '127.0.0.1:39167';
      }
    }

    // Update .env.local if present
    const envPath = path.resolve(process.cwd(), '.env.local');
    const configPath = path.resolve(process.cwd(), 'zcash.config.json');

    const envContent = `# create-zcash-app environment config
ZCASH_NETWORK=${targetNetwork}
ZCASH_CONNECTION_MODE=${connectionMode}
ZCASH_ENDPOINT=${endpoint}
`;
    fs.writeFileSync(envPath, envContent);

    // Update zcash.config.json
    let configData: any = {};
    if (fs.existsSync(configPath)) {
      try {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (e) {}
    }
    configData.network = targetNetwork;
    configData.connectionMode = connectionMode;
    configData.endpoint = endpoint;
    configData.updatedAt = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

    console.log(`\n✅ Switched project configuration to ${targetNetwork}!`);
    console.log(`   Connection Mode: ${connectionMode}`);
    console.log(`   Endpoint:        ${endpoint}`);
    console.log(`   Updated files:   .env.local, zcash.config.json`);
    console.log(`\nThe developer dashboard will automatically reflect the ${targetNetwork} network.\n`);
  });

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

export type DashboardStrategy =
  | { type: 'package'; dir: string; bin: string; command: 'start' }
  | { type: 'monorepo'; dir: string; command: 'dev' }
  | { type: 'none'; error: string };

export interface DashboardResolutionOptions {
  dashboardPkgPath: string | null;
  hasBuiltArtifacts: boolean;
  monorepoDir?: string | null;
  monorepoExists?: boolean;
  resolveNextBin?: (paths: string[]) => string;
}

export function resolveDashboardStrategy(options: DashboardResolutionOptions): DashboardStrategy {
  if (options.dashboardPkgPath && options.hasBuiltArtifacts) {
    const dashboardDir = path.dirname(options.dashboardPkgPath);
    const resolveBin =
      options.resolveNextBin ||
      ((paths) => {
        try {
          return require.resolve('next/dist/bin/next', { paths });
        } catch {
          return require.resolve('next/dist/bin/next');
        }
      });
    let nextBin: string;
    try {
      nextBin = resolveBin([dashboardDir, process.cwd(), __dirname]);
    } catch {
      nextBin = 'next';
    }
    return {
      type: 'package',
      dir: dashboardDir,
      bin: nextBin,
      command: 'start',
    };
  }

  if (options.monorepoExists && options.monorepoDir) {
    return {
      type: 'monorepo',
      dir: options.monorepoDir,
      command: 'dev',
    };
  }

  return {
    type: 'none',
    error:
      'The Zcash Developer Dashboard could not be found.\n' +
      'Ensure @zcash-app/dashboard is installed, or run from within the create-zcash-app repository.',
  };
}

program
  .command('dashboard')
  .description('Launch the Zcash Developer Dashboard')
  .option('-p, --port <port>', 'Port to run dashboard on', '3050')
  .action(async (options) => {
    const port = options.port;
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      console.error(`Invalid port: ${port}`);
      process.exit(1);
    }

    const available = await isPortAvailable(portNum);
    if (!available) {
      console.error(
        `\n⚠️  Port ${port} is already in use.\n` +
        `Please stop the process running on port ${port} or specify another port with --port <port>.\n`
      );
      process.exit(1);
    }

    console.log(`\n🚀 Launching Zcash Developer Dashboard on http://localhost:${port} ...\n`);

    const projectEnv = loadProjectEnv(process.cwd());
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...projectEnv,
      PORT: String(port),
      ZCASH_PROJECT_DIR: process.cwd(),
    };

    if (!childEnv.ZCASH_NETWORK) {
      childEnv.ZCASH_NETWORK = 'regtest';
    }
    if (!childEnv.ZCASH_ENDPOINT) {
      childEnv.ZCASH_ENDPOINT = childEnv.ZCASH_NETWORK === 'regtest' ? '127.0.0.1:39067' : 'testnet.zec.rocks:443';
    }
    if (!childEnv.ZCASH_ZEBRA_RPC && childEnv.ZCASH_NETWORK === 'regtest') {
      childEnv.ZCASH_ZEBRA_RPC = 'http://127.0.0.1:39232';
    }
    if (childEnv.ZCASH_ZEBRA_RPC && !childEnv.ZEBRA_RPC_URL) {
      childEnv.ZEBRA_RPC_URL = childEnv.ZCASH_ZEBRA_RPC;
    }

    // Try resolving @zcash-app/dashboard package
    let dashboardPkgPath: string | null = null;
    try {
      dashboardPkgPath = require.resolve('@zcash-app/dashboard/package.json', {
        paths: [process.cwd(), __dirname],
      });
    } catch {
      try {
        dashboardPkgPath = require.resolve('@zcash-app/dashboard/package.json');
      } catch {
        dashboardPkgPath = null;
      }
    }

    const hasBuiltArtifacts = Boolean(
      dashboardPkgPath && fs.existsSync(path.join(path.dirname(dashboardPkgPath), '.next'))
    );

    const monorepoDashboard = path.resolve(__dirname, '../../dashboard');
    const monorepoExists = fs.existsSync(monorepoDashboard) && fs.existsSync(path.join(monorepoDashboard, 'package.json'));

    const strategy = resolveDashboardStrategy({
      dashboardPkgPath,
      hasBuiltArtifacts,
      monorepoDir: monorepoDashboard,
      monorepoExists,
    });

    if (strategy.type === 'package') {
      const child = spawn(process.execPath, [strategy.bin, strategy.command, '-p', String(port)], {
        cwd: strategy.dir,
        stdio: 'inherit',
        env: childEnv,
      });

      child.on('error', (err) => {
        console.error('Failed to start dashboard:', err);
        process.exit(1);
      });

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });
      return;
    }

    if (strategy.type === 'monorepo') {
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const child = spawn(npx, ['next', strategy.command, '-p', String(port)], {
        cwd: strategy.dir,
        stdio: 'inherit',
        env: childEnv,
      });

      child.on('error', (err) => {
        console.error('Failed to start dashboard:', err);
        process.exit(1);
      });

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });
      return;
    }

    console.error(`\n⚠️  ${strategy.error}\n`);
    process.exit(1);
  });

const testnetCmd = program
  .command('testnet')
  .description('Testnet developer helper tools');

testnetCmd
  .command('lightwalletd')
  .description('Start local testnet lightwalletd connected to local Zebra testnet node')
  .option('--cookie-path <path>', 'Path to Zebra .cookie file', path.join(os.homedir(), 'Library/Caches/zebra/.cookie'))
  .option('--binary <path>', 'Path to lightwalletd binary', process.env.LIGHTWALLETD_PATH || '/tmp/lightwalletd')
  .option('--rpchost <host>', 'Zebra testnet RPC host', '127.0.0.1')
  .option('--rpcport <port>', 'Zebra testnet RPC port', '18232')
  .option('--grpc-bind-addr <addr>', 'gRPC bind address', '127.0.0.1:39167')
  .option('--http-bind-addr <addr>', 'HTTP bind address', '127.0.0.1:39168')
  .option('--data-dir <dir>', 'Lightwalletd cache/data dir', path.join(os.homedir(), '.zcash-app-testnet/lightwalletd-data'))
  .option('--dry-run', 'Validate configuration and build arguments without launching process')
  .action(async (options) => {
    const cookieDisplay = options.cookiePath.replace(os.homedir(), '~');
    console.log(`Reading Zebra RPC cookie from ${cookieDisplay}...`);
    const { user, token } = readZebraCookie(options.cookiePath);
    console.log(`Loaded RPC credentials for user '${user}'.`);
    console.log('Notice: The cookie token changes whenever your Zebra node restarts.');

    const args = buildTestnetLightwalletdArgs({
      rpcHost: options.rpchost,
      rpcPort: options.rpcport,
      cookieUser: user,
      cookieToken: token,
      grpcBind: options.grpcBindAddr,
      httpBind: options.httpBindAddr,
      dataDir: options.dataDir,
    });

    const redacted = redactLightwalletdArgs(args, token);
    console.log('Lightwalletd v0.6.0 command arguments (token redacted):');
    console.log(`  ${redacted.join(' ')}`);

    if (options.dryRun) {
      console.log('Dry-run complete. Lightwalletd process was not started.');
      return;
    }

    const binary = options.binary;
    if (!fs.existsSync(binary)) {
      console.error(`Error: lightwalletd binary not found at ${binary}`);
      process.exit(1);
    }

    if (!fs.existsSync(options.dataDir)) {
      fs.mkdirSync(options.dataDir, { recursive: true });
    }

    console.log(`Starting lightwalletd from ${binary}...`);
    const child = spawn(binary, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      console.log(`Lightwalletd exited with code ${code}`);
    });
  });

export function resolveRegtestDir(explicitPath?: string, stack: string = 'lightwalletd'): string {
  if (explicitPath && explicitPath.trim()) {
    return path.resolve(explicitPath.trim());
  }
  if (process.env.ZCASH_REGTEST_DIR && process.env.ZCASH_REGTEST_DIR.trim()) {
    return path.resolve(process.env.ZCASH_REGTEST_DIR.trim());
  }
  let normalizedStack = stack.toLowerCase();
  if (normalizedStack === 'nu7') normalizedStack = 'lightwalletd';
  if (normalizedStack === 'nu6' || normalizedStack === 'z3') {
    throw new Error(
      'The Z3 / NU6 stack has been removed in 0.1.0-alpha.5. Available stacks: lightwalletd (default), zaino (experimental), full.'
    );
  }
  if (!['lightwalletd', 'zaino', 'full'].includes(normalizedStack)) {
    normalizedStack = 'lightwalletd';
  }

  const candidateBuilt = path.resolve(__dirname, `../docker/stacks/${normalizedStack}`);
  if (fs.existsSync(candidateBuilt) && fs.existsSync(path.join(candidateBuilt, 'docker-compose.yml'))) {
    return candidateBuilt;
  }
  const candidateSrc = path.resolve(__dirname, `../../dev/docker/stacks/${normalizedStack}`);
  if (fs.existsSync(candidateSrc) && fs.existsSync(path.join(candidateSrc, 'docker-compose.yml'))) {
    return candidateSrc;
  }

  // Fallback to legacy regtest-nu7 directory if lightwalletd
  if (normalizedStack === 'lightwalletd') {
    const legacyBuilt = path.resolve(__dirname, '../docker/regtest-nu7');
    if (fs.existsSync(legacyBuilt) && fs.existsSync(path.join(legacyBuilt, 'docker-compose.yml'))) {
      return legacyBuilt;
    }
    const legacySrc = path.resolve(__dirname, '../../dev/docker/regtest-nu7');
    if (fs.existsSync(legacySrc) && fs.existsSync(path.join(legacySrc, 'docker-compose.yml'))) {
      return legacySrc;
    }
  }

  return candidateBuilt;
}

const regtestCmd = program
  .command('regtest')
  .description('Regtest environment management commands');

regtestCmd
  .command('up')
  .alias('setup')
  .description('Configure and initialize regtest stack tier (default: lightwalletd, or --stack zaino | full)')
  .option('--stack <stack>', 'Regtest stack tier to run (lightwalletd | zaino | full)', 'lightwalletd')
  .option('--regtest-path <path>', 'Path to regtest docker directory', '')
  .action(async (options) => {
    let stack = (options.stack || 'lightwalletd').toLowerCase();
    if (stack === 'nu7') stack = 'lightwalletd';
    if (stack === 'z3' || stack === 'nu6') {
      console.error(
        '❌ The Z3 / NU6 stack has been removed in 0.1.0-alpha.5. Available stacks: lightwalletd (default), zaino (experimental), full.'
      );
      process.exit(1);
    }
    const rawPath = options.regtestPath;
    let regtestDir: string;
    try {
      regtestDir = resolveRegtestDir(rawPath, stack);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
    if (!fs.existsSync(regtestDir)) {
      console.error(`❌ Could not locate regtest directory at: ${regtestDir}. Please specify with --regtest-path <path> or ZCASH_REGTEST_DIR.`);
      process.exit(1);
    }

    // Single active stack enforcement: verify no other regtest containers are running
    try {
      const runningOut = execSync('docker ps --filter "name=zcash-regtest-" --format "{{.Names}}"', { encoding: 'utf8' }).trim();
      if (runningOut) {
        const activeContainers = runningOut.split('\n').map((s: string) => s.trim()).filter(Boolean);
        const foreignContainers = activeContainers.filter((name: string) => !name.includes(`zcash-regtest-${stack}`));
        if (foreignContainers.length > 0) {
          console.error(
            `❌ Cannot start regtest stack "${stack}": another regtest stack is already running:\n` +
            foreignContainers.map((c: string) => `   - ${c}`).join('\n') +
            `\nOnly one regtest stack can run at a time due to shared host port 39232 (single active stack rule).\n` +
            `Stop the active stack first (e.g. zcash-dev regtest down) before starting another tier.`
          );
          process.exit(1);
        }
      }
    } catch {}

    // Verify or build stack images
    if (stack === 'zaino') {
      const zainoImg = process.env.ZAINO_IMAGE || 'zaino:nu7-aaf8122a';
      let hasImage = false;
      try {
        execSync(`docker image inspect "${zainoImg}"`, { stdio: 'ignore' });
        hasImage = true;
      } catch {}
      if (!hasImage) {
        console.log(`\n📦 Image "${zainoImg}" not found locally. Building Zaino feat/nu7 from source (~3+ minutes)...`);
        execSync(`cd "${regtestDir}" && docker compose build zaino`, { stdio: 'inherit' });
      }
    } else if (stack === 'full') {
      const zebraIndexerImg = process.env.ZEBRA_IMAGE || 'zebra:7.0.0-indexer';
      let hasImage = false;
      try {
        execSync(`docker image inspect "${zebraIndexerImg}"`, { stdio: 'ignore' });
        hasImage = true;
      } catch {}
      if (!hasImage) {
        console.log(`\n📦 Image "${zebraIndexerImg}" not found locally.`);
        console.log(`🔨 Building Zebra 7.0.0 with indexer features (~8 minutes on initial build)...`);
        execSync(`cd "${regtestDir}" && docker compose build zebra`, { stdio: 'inherit' });
      }
    }

    console.log(`\n=== 🛠️  Setting up ${stack.toUpperCase()} Regtest in ${regtestDir} ===\n`);
    const accountUa = getRegtestAccount0MinerAddress('regtest');
    console.log(`✅ Using Account 0 Unified Address for mining:\n   ${accountUa}`);

    const zebraTomlPath = path.join(regtestDir, 'zebra.toml');
    if (fs.existsSync(zebraTomlPath)) {
      let zebraConfig = fs.readFileSync(zebraTomlPath, 'utf8');
      if (!zebraConfig.includes('[mining]')) {
        zebraConfig += `\n[mining]\nminer_address = "${accountUa}"\nminer_memo = "regtest"\n`;
      } else {
        zebraConfig = zebraConfig.replace(/miner_address\s*=\s*".*"/, `miner_address = "${accountUa}"`);
        if (zebraConfig.includes('miner_memo')) {
          zebraConfig = zebraConfig.replace(/miner_memo\s*=\s*".*"/, `miner_memo = "regtest"`);
        } else {
          zebraConfig = zebraConfig.replace('[mining]', `[mining]\nminer_memo = "regtest"`);
        }
      }
      fs.writeFileSync(zebraTomlPath, zebraConfig);
      console.log(`✅ Updated ${path.basename(zebraTomlPath)} with Account 0 miner address.`);
    }

    console.log(`\n🐳 Starting ${stack.toUpperCase()} Regtest containers...`);
    const initScript = path.join(regtestDir, 'regtest-init.sh');
    if (fs.existsSync(initScript)) {
      try {
        execSync(`cd "${regtestDir}" && bash "${initScript}"`, { stdio: 'inherit' });
      } catch {
        console.error('regtest-init.sh failed, see output above');
        process.exit(1);
      }
    } else {
      execSync(`cd "${regtestDir}" && docker compose up -d`, { stdio: 'inherit' });
    }

    const zebraRpcPort = process.env.ZEBRA_RPC_PORT || '39232';
    console.log(`\n⏳ Waiting for Zebra RPC on port ${zebraRpcPort}...`);
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${zebraRpcPort}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getblockchaininfo', params: [] }),
        });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) {
      console.error('❌ Zebra RPC did not become ready in time.');
      process.exit(1);
    }

    const bciRes = await (await fetch(`http://127.0.0.1:${zebraRpcPort}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getblockcount', params: [] }),
    })).json();
    const currentHeight = Number(bciRes.result || 0);
    console.log(`Current block height: ${currentHeight}`);
    if (currentHeight < 110) {
      const needed = 110 - currentHeight;
      console.log(`Mining ${needed} blocks for coinbase maturity (target tip 110)...`);
      await fetch(`http://127.0.0.1:${zebraRpcPort}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'generate', params: [needed] }),
      });
      console.log('✅ Mined maturity blocks.');
    }

    console.log(`\n🎉 ${stack.toUpperCase()} Regtest setup completed successfully! Stack is ready for SDK testing.\n`);
  });

regtestCmd
  .command('down')
  .description('Stop regtest stack containers')
  .option('--stack <stack>', 'Regtest stack tier to stop (lightwalletd | zaino | full)', 'lightwalletd')
  .option('--regtest-path <path>', 'Path to regtest docker directory', '')
  .action((options) => {
    let stack = (options.stack || 'lightwalletd').toLowerCase();
    if (stack === 'nu7') stack = 'lightwalletd';
    const rawPath = options.regtestPath;
    const regtestDir = resolveRegtestDir(rawPath, stack);
    execSync(`cd "${regtestDir}" && docker compose down`, { stdio: 'inherit' });
    console.log(`\n🛑 ${stack.toUpperCase()} regtest containers stopped.\n`);
  });

regtestCmd
  .command('wipe')
  .alias('reset')
  .description('Wipe and reset the regtest blockchain, indexer, and wallet data')
  .option('--stack <stack>', 'Regtest stack tier to wipe (lightwalletd | zaino | full)', 'lightwalletd')
  .option('--regtest-path <path>', 'Path to regtest docker directory', '')
  .option('-y, --yes', 'Confirm wiping regtest blockchain without interactive prompt')
  .option('--dry-run', 'Derive and print exact volumes/containers to be wiped without executing')
  .action(async (options) => {
    let stack = (options.stack || 'lightwalletd').toLowerCase();
    if (stack === 'nu7') stack = 'lightwalletd';
    const rawPath = options.regtestPath;
    let regtestDir: string;
    try {
      regtestDir = resolveRegtestDir(rawPath, stack);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
    if (!fs.existsSync(regtestDir)) {
      console.error(`❌ Could not locate regtest directory at: ${regtestDir}. Please specify with --regtest-path <path> or ZCASH_REGTEST_DIR.`);
      process.exit(1);
    }

    const composePath = path.join(regtestDir, 'docker-compose.yml');
    if (!fs.existsSync(composePath)) {
      console.error(`❌ Refusing to wipe: ${composePath} not found. Must be executed against a valid regtest project.`);
      process.exit(1);
    }

    const composeContent = fs.readFileSync(composePath, 'utf8');
    const projectNameMatch = composeContent.match(/^name:\s*(.+)$/m);
    const projectName = projectNameMatch ? projectNameMatch[1].trim() : `zcash-regtest-${stack}`;
    const ALLOWED_PROJECT_NAMES = [
      'zcash-regtest-lightwalletd',
      'zcash-regtest-zaino',
      'zcash-regtest-full',
      'zcash-regtest-nu7',
    ];
    if (!ALLOWED_PROJECT_NAMES.includes(projectName)) {
      console.error(`❌ Refusing to wipe: Expected name to be one of [${ALLOWED_PROJECT_NAMES.join(', ')}], but found "${projectName}". Only regtest environments may be wiped.`);
      process.exit(1);
    }

    let dynamicVolumes: string[] = [];
    let dynamicServices: string[] = [];
    try {
      const vOutput = execSync(`cd "${regtestDir}" && docker compose config --volumes`, { encoding: 'utf8' });
      dynamicVolumes = vOutput.split('\n').map((v: string) => v.trim()).filter(Boolean).map((v: string) => `${projectName}_${v}`);
    } catch {
      dynamicVolumes = [`${projectName}_zebra-data`];
    }

    try {
      const sOutput = execSync(`cd "${regtestDir}" && docker compose config --services`, { encoding: 'utf8' });
      dynamicServices = sOutput.split('\n').map((s: string) => s.trim()).filter(Boolean);
    } catch {
      dynamicServices = ['zebra'];
    }

    console.log('\n⚠️  WARNING: You are about to permanently destroy the regtest cluster data:');
    console.log(`   - Project Name:   ${projectName}`);
    console.log(`   - Docker Volumes: ${dynamicVolumes.join(', ')}`);
    console.log(`   - Services:       ${dynamicServices.join(', ')}`);
    console.log('   - Chain State:    All mined blocks, commitment trees, transactions, and spent nullifiers');
    console.log('   - Accounts:       All local test accounts and note balances will be wiped to genesis\n');

    if (options.dryRun) {
      console.log('🔍 [Dry Run] Would execute:');
      console.log(`   1. docker compose down -v (purges volumes: ${dynamicVolumes.join(', ')})`);
      console.log('   2. bash regtest-init.sh (re-initializes genesis credentials and parameters)');
      console.log(`   3. docker compose up -d`);
      console.log('\n✅ [Dry Run complete: zero destructive actions executed.]');
      return;
    }

    let confirmed = !!options.yes;
    if (!confirmed) {
      if (process.stdin.isTTY) {
        const response = await prompts({
          type: 'confirm',
          name: 'confirmWipe',
          message: 'Are you sure you want to permanently delete all regtest volumes and reset to block 1?',
          initial: false,
        });
        confirmed = response.confirmWipe;
      }
    }

    if (!confirmed) {
      console.error('❌ Wipe aborted: explicit confirmation required (use --yes to run non-interactively).');
      process.exit(1);
    }

    console.log(`\n=== 🧹 Wiping Regtest Blockchain in ${regtestDir} ===\n`);
    execSync(`cd "${regtestDir}" && docker compose down -v`, { stdio: 'inherit' });

    console.log(`\n=== 🛠️  Reinitializing fresh ${stack.toUpperCase()} chain via regtest-init.sh ===\n`);
    const initScript = path.join(regtestDir, 'regtest-init.sh');
    if (fs.existsSync(initScript)) {
      try {
        execSync(`cd "${regtestDir}" && bash "${initScript}"`, { stdio: 'inherit' });
      } catch {
        console.error('regtest-init.sh failed, see output above');
        process.exit(1);
      }
    } else {
      execSync(`cd "${regtestDir}" && docker compose up -d`, { stdio: 'inherit' });
    }

    const zebraRpcPort = process.env.ZEBRA_RPC_PORT || '39232';
    console.log(`⏳ Waiting for Zebra RPC on port ${zebraRpcPort}...`);
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${zebraRpcPort}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getblockchaininfo', params: [] }),
        });
        if (res.ok) break;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log('Mining 110 blocks for fresh regtest chain...');
    await fetch(`http://127.0.0.1:${zebraRpcPort}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'generate', params: [110] }),
    });
    console.log(`✅ Fresh ${stack.toUpperCase()} regtest chain created with tip height 110!\n`);
  });

const isEntrypoint =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === __filename ||
    path.basename(process.argv[1]) === 'zcash-dev' ||
    process.argv[1].endsWith('dist/cli.js'));

if (isEntrypoint) {
  program.parse(process.argv);
}

export { program };
