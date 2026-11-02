#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import os from 'os';
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

export function getRegtestAccount0MinerAddress(network: string = 'regtest-nu7'): string {
  if (network !== 'regtest' && network !== 'regtest-nu7') {
    throw new Error(
      `Security Error: Refusing miner address derivation for non-regtest network "${network}". KNOWN_TEST_MNEMONICS is strictly restricted to regtest.`
    );
  }
  const acct = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, network as any);
  return acct.getUnifiedAddress();
}

const REMOTE_ENDPOINTS: Record<string, string> = {
  regtest: '127.0.0.1:28137',
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
  .option('-e, --endpoint <endpoint>', 'Zaino gRPC endpoint', '127.0.0.1:28137')
  .option('-n, --network <network>', 'Network (regtest | testnet | mainnet)', 'regtest')
  .option('--nu7', 'Opt-in to NU7 consensus branch expectations on regtest')
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
  const isNu7 = network === 'regtest' && (regtestStack === 'nu7' || endpoint.includes('39067') || (!regtestStack && !endpoint.includes('28137')));
  const effectiveNetwork = isNu7 ? 'regtest-nu7' : network;
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
      const isNu7 = network === 'regtest' && (regtestStack === 'nu7' || endpoint.includes('39067') || (!regtestStack && !endpoint.includes('28137')));
      const effectiveNetwork = isNu7 ? 'regtest-nu7' : network;
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
      const isNu7 = network === 'regtest' && (regtestStack === 'nu7' || endpoint.includes('39067') || (!regtestStack && !endpoint.includes('28137')));
      const effectiveNetwork = isNu7 ? 'regtest-nu7' : network;
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
  stack: 'nu7' | 'z3';
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
    if (endpointOpt && (endpointOpt.includes('39067') || endpointOpt.includes('39232'))) {
      stack = 'nu7';
    } else if (endpointOpt && (endpointOpt.includes('28137') || endpointOpt.includes('8181'))) {
      stack = 'z3';
    } else {
      stack = 'nu7';
    }
  }

  if (stack !== 'nu7' && stack !== 'z3') {
    throw new Error(`Invalid regtest stack "${stack}". Must be "nu7" or "z3".`);
  }

  const zatoshis = parseZecToZatoshis(options.amount);
  const effectiveFetch = deps?.fetchFn ?? fetch;

  if (stack === 'nu7') {
    const effectiveEndpoint = options.endpoint || env.ZCASH_ENDPOINT || '127.0.0.1:39067';
    const minerAccount = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest-nu7');
    const client = deps?.client ?? createClient({ endpoint: effectiveEndpoint, network: 'regtest-nu7' });
    const openFn = deps?.openWalletFn ?? ((...args: Parameters<typeof WalletHandle.open>) => WalletHandle.open(...args));
    const syncFn = deps?.syncWalletFn ?? syncWallet;
    const sendFn = deps?.sendFn ?? send;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-fund-'));
    const dbPath = path.join(tempDir, 'wallet.db');
    let result;
    try {
      const wallet = openFn(
        dbPath,
        'regtest-nu7',
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
          `Could not connect to NU7 lightwalletd indexer at ${redactSecretUrl(effectiveEndpoint)}. Is the NU7 stack running? Run: zcash-dev regtest up --stack nu7 (${msg})`
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
      stack: 'nu7',
      recipient: options.address,
      amountZec: options.amount,
      zatoshis,
      endpoint: redactSecretUrl(effectiveEndpoint),
    };
  } else {
    const rpcRouterUrl = 'http://127.0.0.1:8181';
    let addrData: any;
    try {
      const addrRes = await effectiveFetch(rpcRouterUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'fund-listaddresses',
          method: 'listaddresses',
          params: [],
        }),
      });
      if (!addrRes.ok) {
        throw new Error(`Zallet HTTP ${addrRes.status}: ${addrRes.statusText}`);
      }
      addrData = await addrRes.json();
    } catch (err: any) {
      throw new Error(
        `Could not connect to Z3 RPC router / Zallet at ${rpcRouterUrl}. Is the Z3 stack running? Run: zcash-dev regtest up --stack nu6 (${err.message || err})`
      );
    }

    const accounts = addrData?.result?.[0]?.unified;
    const senderUa = accounts?.[0]?.addresses?.[0]?.address;
    if (!senderUa) {
      throw new Error('No sender address found in Zallet regtest wallet');
    }

    const isNegative = zatoshis < 0n;
    const abs = isNegative ? -zatoshis : zatoshis;
    const whole = abs / 100_000_000n;
    const frac = abs % 100_000_000n;
    const amountZec = `${isNegative ? '-' : ''}${whole}.${frac.toString().padStart(8, '0')}`;

    const sendRes = await effectiveFetch(rpcRouterUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'fund-sendmany',
        method: 'z_sendmany',
        params: [senderUa, [{ address: options.address, amount: amountZec }]],
      }),
    });
    if (!sendRes.ok) {
      throw new Error(`Zallet z_sendmany HTTP ${sendRes.status}: ${sendRes.statusText}`);
    }
    const sendData: any = await sendRes.json();
    if (sendData.error) {
      throw new Error(`Zallet z_sendmany RPC error: ${sendData.error.message || JSON.stringify(sendData.error)}`);
    }
    const txid = sendData.result;
    return {
      txid,
      stack: 'z3',
      recipient: options.address,
      amountZec: options.amount,
      zatoshis,
      endpoint: rpcRouterUrl,
    };
  }
}

program
  .command('mine')
  .description('Mine blocks on regtest')
  .argument('[blocks]', 'Number of blocks to mine', '1')
  .option('-e, --endpoint <endpoint>', 'Zebra RPC or Zaino endpoint')
  .option('--stack <stack>', 'Regtest stack (nu7 | z3)')
  .action(async (blocksStr, options) => {
    try {
      applyProjectEnv();
      const env = loadProjectEnv();
      const blocks = parseInt(blocksStr, 10);
      let stack = (options.stack || env.ZCASH_REGTEST_STACK || '').trim().toLowerCase();
      const endpointOpt = options.endpoint || env.ZCASH_ENDPOINT;
      const zebraRpcOpt = env.ZCASH_ZEBRA_RPC;

      if (!stack) {
        if ((endpointOpt && (endpointOpt.includes('39067') || endpointOpt.includes('39232'))) || (zebraRpcOpt && zebraRpcOpt.includes('39232'))) {
          stack = 'nu7';
        } else if ((endpointOpt && (endpointOpt.includes('28137') || endpointOpt.includes('8181'))) || (zebraRpcOpt && zebraRpcOpt.includes('18232'))) {
          stack = 'z3';
        } else {
          stack = 'nu7';
        }
      }

      console.log(`Mining ${blocks} block(s) on ${stack.toUpperCase()} regtest stack...`);
      if (stack === 'nu7') {
        const zebraUrl = (options.endpoint && options.endpoint.startsWith('http'))
          ? options.endpoint
          : (zebraRpcOpt || 'http://127.0.0.1:39232');
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
            `Could not connect to Zebra JSON-RPC at ${zebraUrl}. Is the NU7 stack running? Run: zcash-dev regtest up --stack nu7 (${err.message})`
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
      } else {
        const rpcRouterUrl = 'http://127.0.0.1:8181';
        let res;
        try {
          res = await fetch(rpcRouterUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'zcash-dev-mine',
              method: 'generate',
              params: [blocks],
            }),
          });
        } catch (err: any) {
          throw new Error(
            `Could not connect to Z3 RPC router at ${rpcRouterUrl}. Is the Z3 stack running? Run: zcash-dev regtest up --stack nu6 (${err.message})`
          );
        }
        if (!res.ok) {
          throw new Error(`Z3 mining HTTP ${res.status}: ${res.statusText}`);
        }
        const data: any = await res.json();
        if (data.error) {
          throw new Error(`Z3 mining JSON-RPC error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        console.log(`✅ Successfully mined ${blocks} block(s) on Z3 stack.`);
      }
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
  .option('-e, --endpoint <endpoint>', 'Zaino / lightwalletd gRPC endpoint')
  .option('--stack <stack>', 'Regtest stack (nu7 | z3)')
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
    let endpoint = '127.0.0.1:28137';

    if (targetNetwork === 'regtest') {
      connectionMode = 'local';
      endpoint = '127.0.0.1:28137';
    } else {
      if (options.remote) {
        connectionMode = 'remote';
        endpoint = REMOTE_ENDPOINTS[targetNetwork];
      } else if (options.local) {
        connectionMode = 'local';
        endpoint = '127.0.0.1:8137';
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
              title: `🐳 Local Z3 Node (127.0.0.1:8137) — Self-hosted node`,
              value: 'local',
            },
          ],
          initial: 0,
        });
        connectionMode = modeResponse.mode;
        endpoint = connectionMode === 'remote' ? REMOTE_ENDPOINTS[targetNetwork] : '127.0.0.1:8137';
      }
    }

    // Update .env.local if present
    const envPath = path.resolve(process.cwd(), '.env.local');
    const configPath = path.resolve(process.cwd(), 'zcash.config.json');

    const envContent = `# create-zcash-app environment config
ZCASH_NETWORK=${targetNetwork}
ZCASH_CONNECTION_MODE=${connectionMode}
ZCASH_ENDPOINT=${endpoint}
Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0-no-tls
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

program
  .command('dashboard')
  .description('Launch the Zcash Developer Dashboard')
  .option('-p, --port <port>', 'Port to run dashboard on', '3050')
  .action((options) => {
    const port = options.port;
    console.log(`\n🚀 Launching Zcash Developer Dashboard on http://localhost:${port} ...\n`);

    // Look for dashboard directory in monorepo packages or locally installed package
    const monorepoDashboard = path.resolve(__dirname, '../../dashboard');

    if (!fs.existsSync(monorepoDashboard) || !fs.existsSync(path.join(monorepoDashboard, 'package.json'))) {
      console.error(
        `\n⚠️  The Zcash Developer Dashboard is a full Next.js App Router application maintained in the repository.\n` +
        `Running the dashboard from a standalone npm package outside the monorepo clone is unsupported.\n\n` +
        `To launch the Developer Dashboard:\n` +
        `  1. Clone the repository:\n` +
        `     git clone https://github.com/Ultra-Tech-code/create-zcash-app.git\n` +
        `     cd create-zcash-app\n` +
        `  2. Install dependencies & build:\n` +
        `     pnpm install && pnpm build\n` +
        `  3. Run the dashboard:\n` +
        `     pnpm --filter dashboard run dev\n` +
        `     # or: cd packages/dashboard && pnpm dev\n`
      );
      process.exit(1);
    }

    const dashboardCwd = monorepoDashboard;

    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(npx, ['next', 'dev', '-p', port], {
      cwd: dashboardCwd,
      stdio: 'inherit',
      env: { ...process.env, PORT: port },
    });

    child.on('error', (err) => {
      console.error('Failed to start dashboard:', err);
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
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

export function resolveRegtestDir(explicitPath?: string, stack: string = 'nu6'): string {
  if (explicitPath && explicitPath.trim()) {
    return path.resolve(explicitPath.trim());
  }
  if (process.env.ZCASH_REGTEST_DIR && process.env.ZCASH_REGTEST_DIR.trim()) {
    return path.resolve(process.env.ZCASH_REGTEST_DIR.trim());
  }
  const isNu7 = stack.toLowerCase() === 'nu7';
  const folder = isNu7 ? 'regtest-nu7' : 'regtest';
  const candidateBuilt = path.resolve(__dirname, `../docker/${folder}`);
  if (fs.existsSync(candidateBuilt) && fs.existsSync(path.join(candidateBuilt, 'docker-compose.yml'))) {
    return candidateBuilt;
  }
  const candidateSrc = path.resolve(__dirname, `../../dev/docker/${folder}`);
  if (fs.existsSync(candidateSrc) && fs.existsSync(path.join(candidateSrc, 'docker-compose.yml'))) {
    return candidateSrc;
  }
  return candidateBuilt;
}

const regtestCmd = program
  .command('regtest')
  .description('Regtest environment management commands');

regtestCmd
  .command('up')
  .alias('setup')
  .description('Configure and initialize regtest stack (default: z3 nu6, or --stack nu7)')
  .option('--stack <stack>', 'Regtest stack to run (nu6 | nu7)', 'nu6')
  .option('--regtest-path <path>', 'Path to regtest docker directory', '')
  .option('--z3-path <path>', 'Deprecated alias for --regtest-path', '')
  .action(async (options) => {
    const stack = (options.stack || 'nu6').toLowerCase();
    const regtestDir = resolveRegtestDir(options.regtestPath || options.z3Path, stack);
    if (!fs.existsSync(regtestDir)) {
      console.error(`❌ Could not locate regtest directory at: ${regtestDir}. Please specify with --regtest-path <path> or ZCASH_REGTEST_DIR.`);
      process.exit(1);
    }

    if (stack === 'nu7') {
      console.log(`\n=== 🛠️  Setting up NU7 Regtest (Zebra 7.0.0 + lightwalletd) in ${regtestDir} ===\n`);
      const accountUa = getRegtestAccount0MinerAddress('regtest-nu7');
      console.log(`✅ Using Account 0 Unified Address for NU7 mining:\n   ${accountUa}`);

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

      console.log('\n🐳 Starting NU7 Regtest containers...');
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
      if (currentHeight < 105) {
        const needed = 105 - currentHeight;
        console.log(`Mining ${needed} blocks for coinbase maturity (target tip 105)...`);
        await fetch(`http://127.0.0.1:${zebraRpcPort}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'generate', params: [needed] }),
        });
        console.log('✅ Mined maturity blocks.');
      }

      console.log('\n🎉 NU7 Regtest setup completed successfully! Stack is ready for SDK testing.\n');
      return;
    }

    console.log(`\n=== 🛠️  Setting up Regtest in ${regtestDir} ===\n`);

    // Ensure docker stack is up
    console.log('\n🐳 Starting Regtest containers...');
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

    // 3. Wait for Zallet / RPC router at http://127.0.0.1:8181
    console.log('\n⏳ Waiting for RPC router at http://127.0.0.1:8181 ...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('http://127.0.0.1:8181', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'listaddresses', params: [] }),
        });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) {
      console.error('❌ RPC router did not become ready in time.');
      process.exit(1);
    }

    // 4. Check for existing Zallet accounts or create one if missing
    console.log('\n🔍 Checking Zallet accounts...');
    let listRes = await (await fetch('http://127.0.0.1:8181', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'listaddresses', params: [] }),
    })).json();

    let accountUa: string | undefined;
    let accounts = listRes.result?.[0]?.unified?.[0]?.addresses || [];
    if (accounts.length === 0) {
      console.log('No Zallet account found. Creating new default account...');
      const createRes = await (await fetch('http://127.0.0.1:8181', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'z_getnewaccount', params: ['default'] }),
      })).json();
      console.log('✅ Created account:', createRes.result);

      listRes = await (await fetch('http://127.0.0.1:8181', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'listaddresses', params: [] }),
      })).json();
      accounts = listRes.result?.[0]?.unified?.[0]?.addresses || [];
    }

    accountUa = accounts[0]?.address;
    if (!accountUa) {
      console.error('❌ Could not retrieve unified address from Zallet.');
      process.exit(1);
    }
    console.log(`✅ Using Zallet Unified Address:\n   ${accountUa}`);

    // 5. Configure zebra.toml with miner_address and miner_memo
    const zebraTomlPath = fs.existsSync(path.join(regtestDir, 'zebra.toml'))
      ? path.join(regtestDir, 'zebra.toml')
      : path.join(regtestDir, 'config/regtest/zebra.toml');
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
      console.log(`\n✅ Updated ${path.basename(zebraTomlPath)}:`);
      console.log(`   - miner_address = "${accountUa}"`);
      console.log(`   - miner_memo = "regtest"`);
    }

    // 6. Restart Zebra to apply mining configuration
    console.log('\n🔄 Restarting Zebra container with new mining config...');
    execSync(`cd "${regtestDir}" && docker compose up -d --force-recreate zebra`, { stdio: 'inherit' });

    // 7. Verify live config
    const liveConfig = execSync(`docker exec z3-regtest-zebra-1 cat /home/zebra/.config/zebrad.toml`).toString();
    console.log('\n--- Confirmed Live Zebrad Config ---');
    const miningSection = liveConfig.match(/\[mining\][^\[]*/)?.[0] || 'N/A';
    console.log(miningSection);

    // 8. Wait for Zebra RPC to be ready after restart and check block height
    console.log('⏳ Waiting for Zebra RPC to be ready after restart...');
    let currentHeight = 0;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('http://127.0.0.1:8181', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getblockcount', params: [] }),
        });
        if (res.ok) {
          const json: any = await res.json();
          if (json.result !== undefined) {
            currentHeight = Number(json.result);
            break;
          }
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`Current block height: ${currentHeight}`);
    if (currentHeight < 101) {
      const needed = 101 - currentHeight;
      console.log(`Mining ${needed} initial blocks for coinbase maturity...`);
      await fetch('http://127.0.0.1:8181', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'generate', params: [needed] }),
      });
      console.log('✅ Mined maturity blocks.');
    }

    console.log('\n🎉 Regtest setup completed successfully! Stack is ready for dev.fund and SDK testing.\n');
  });

regtestCmd
  .command('wipe')
  .alias('reset')
  .description('Wipe and reset the regtest blockchain, indexer, and wallet data')
  .option('--stack <stack>', 'Regtest stack to wipe (nu6 | nu7)', 'nu6')
  .option('--regtest-path <path>', 'Path to regtest docker directory', '')
  .option('--z3-path <path>', 'Deprecated alias for --regtest-path', '')
  .option('-y, --yes', 'Confirm wiping regtest blockchain without interactive prompt')
  .option('--dry-run', 'Derive and print exact volumes/containers to be wiped without executing')
  .action(async (options) => {
    const stack = (options.stack || 'nu6').toLowerCase();
    const regtestDir = resolveRegtestDir(options.regtestPath || options.z3Path, stack);
    if (!fs.existsSync(regtestDir)) {
      console.error(`❌ Could not locate regtest directory at: ${regtestDir}. Please specify with --regtest-path <path> or ZCASH_REGTEST_DIR.`);
      process.exit(1);
    }

    // Safety check: Verify docker-compose.yml exists in regtest directory
    const composePath = path.join(regtestDir, 'docker-compose.yml');
    if (!fs.existsSync(composePath)) {
      console.error(`❌ Refusing to wipe: ${composePath} not found. Must be executed against a valid regtest project.`);
      process.exit(1);
    }

    const composeContent = fs.readFileSync(composePath, 'utf8');
    const projectNameMatch = composeContent.match(/^name:\s*(.+)$/m);
    const projectName = projectNameMatch ? projectNameMatch[1].trim() : 'z3-regtest';
    const ALLOWED_PROJECT_NAMES = ['z3-regtest', 'zcash-regtest-nu7'];
    if (!ALLOWED_PROJECT_NAMES.includes(projectName)) {
      console.error(`❌ Refusing to wipe: Expected name to be one of [${ALLOWED_PROJECT_NAMES.join(', ')}], but found "${projectName}". Only regtest environments may be wiped.`);
      process.exit(1);
    }

    // Dynamically derive volumes and services from docker compose config at runtime
    let dynamicVolumes: string[] = [];
    let dynamicServices: string[] = [];
    try {
      const vOutput = execSync(`cd "${regtestDir}" && docker compose config --volumes`, { encoding: 'utf8' });
      dynamicVolumes = vOutput.split('\n').map((v: string) => v.trim()).filter(Boolean).map((v: string) => `${projectName}_${v}`);
    } catch (e: any) {
      dynamicVolumes = projectName === 'zcash-regtest-nu7'
        ? [`${projectName}_zebra-data`]
        : [`${projectName}_chain`, `${projectName}_zallet`, `${projectName}_cookie`, `${projectName}_zallet_ca_certificates`];
    }

    try {
      const sOutput = execSync(`cd "${regtestDir}" && docker compose config --services`, { encoding: 'utf8' });
      dynamicServices = sOutput.split('\n').map((s: string) => s.trim()).filter(Boolean);
    } catch (e: any) {
      dynamicServices = projectName === 'zcash-regtest-nu7' ? ['zebra', 'lightwalletd'] : ['zebra', 'cookie-permissions', 'zallet', 'rpc-router'];
    }

    // Print dynamically derived resource deletion warning
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

    if (projectName === 'zcash-regtest-nu7' || stack === 'nu7') {
      console.log('\n=== 🛠️  Reinitializing fresh NU7 chain via regtest-init.sh ===\n');
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

      console.log('Mining 105 blocks for fresh regtest chain...');
      await fetch(`http://127.0.0.1:${zebraRpcPort}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'generate', params: [105] }),
      });
      console.log('✅ Fresh NU7 regtest chain created with tip height 105!\n');
      return;
    }

    console.log('\n=== 🛠️  Reinitializing fresh chain via regtest-init.sh ===\n');
    const initScript = path.join(regtestDir, 'regtest-init.sh');
    const legacyInitScript = path.join(regtestDir, 'scripts/regtest-init.sh');
    try {
      if (fs.existsSync(initScript)) {
        execSync(`cd "${regtestDir}" && bash "${initScript}"`, { stdio: 'inherit' });
      } else if (fs.existsSync(legacyInitScript)) {
        execSync(`cd "${regtestDir}" && bash "${legacyInitScript}"`, { stdio: 'inherit' });
      }
    } catch {
      console.error('regtest-init.sh failed, see output above');
      process.exit(1);
    }
    execSync(`cd "${regtestDir}" && docker compose up -d && docker compose up -d zaino`, { stdio: 'inherit' });

    const waitForRpc = async (payload: any, maxAttempts = 45): Promise<any> => {
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const res = await fetch('http://127.0.0.1:8181', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const json = await res.json();
            if (json.result !== undefined || json.error !== undefined) {
              return json;
            }
          }
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`RPC endpoint http://127.0.0.1:8181 failed to become ready for ${payload.method}`);
    };

    console.log('⏳ Waiting for RPC router at http://127.0.0.1:8181 ...');
    await waitForRpc({ jsonrpc: '2.0', id: 1, method: 'listaddresses', params: [] });

    console.log('\nCreating new default Zallet account if needed...');
    let listRes = await waitForRpc({ jsonrpc: '2.0', id: 1, method: 'listaddresses', params: [] });
    let accounts = listRes.result?.[0]?.unified?.[0]?.addresses || [];
    if (accounts.length === 0) {
      await waitForRpc({ jsonrpc: '2.0', id: 1, method: 'z_getnewaccount', params: ['default'] });
      listRes = await waitForRpc({ jsonrpc: '2.0', id: 1, method: 'listaddresses', params: [] });
      accounts = listRes.result?.[0]?.unified?.[0]?.addresses || [];
    }
    const accountUa = accounts[0]?.address;
    console.log(`✅ Using Zallet Unified Address: ${accountUa}`);

    if (accountUa) {
      const zebraTomlPath = fs.existsSync(path.join(regtestDir, 'zebra.toml'))
        ? path.join(regtestDir, 'zebra.toml')
        : path.join(regtestDir, 'config/regtest/zebra.toml');
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
      }

      execSync(`cd "${regtestDir}" && docker compose up -d --force-recreate zebra`, { stdio: 'inherit' });
    }

    console.log('⏳ Waiting for Zebra RPC after restart...');
    await waitForRpc({ jsonrpc: '2.0', id: 1, method: 'getblockcount', params: [] });

    console.log('Mining 105 blocks for fresh regtest chain...');
    await fetch('http://127.0.0.1:8181', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'generate', params: [105] }),
    });
    execSync(`cd "${regtestDir}" && docker compose up -d zaino`, { stdio: 'inherit' });
    console.log('✅ Fresh regtest chain created with tip height 105!\n');
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
