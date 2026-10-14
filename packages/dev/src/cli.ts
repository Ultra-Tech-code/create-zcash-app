#!/usr/bin/env node
import { Command } from 'commander';
import { createClient, dev, accountFromMnemonic } from '@zcash-app/sdk';

const program = new Command();

program
  .name('zcash-dev')
  .description('Regtest helper CLI for shielded Zcash apps')
  .version('0.1.0');

program
  .command('info')
  .description('Get node & indexer status')
  .option('-e, --endpoint <endpoint>', 'Zaino gRPC endpoint', '127.0.0.1:8137')
  .option('-n, --network <network>', 'Network (regtest | testnet | mainnet)', 'regtest')
  .action(async (options) => {
    const client = createClient({
      endpoint: options.endpoint,
      network: options.network as any,
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

program
  .command('mine')
  .description('Mine blocks on regtest')
  .argument('[blocks]', 'Number of blocks to mine', '1')
  .option('-e, --endpoint <endpoint>', 'Zaino gRPC endpoint', '127.0.0.1:8137')
  .action(async (blocksStr, options) => {
    const blocks = parseInt(blocksStr, 10);
    const client = createClient({
      endpoint: options.endpoint,
      network: 'regtest',
    });
    try {
      console.log(`Mining ${blocks} block(s)...`);
      await dev.mine(client, blocks);
      console.log(`✅ Successfully mined ${blocks} block(s).`);
    } catch (err: any) {
      console.error('Mining failed:', err.message || err);
      process.exit(1);
    } finally {
      await client.close();
    }
  });

program
  .command('fund')
  .description('Fund a Unified Address on regtest')
  .argument('<address>', 'Recipient Unified Address')
  .argument('[amount]', 'Amount in ZEC', '1.0')
  .option('-e, --endpoint <endpoint>', 'Zaino gRPC endpoint', '127.0.0.1:8137')
  .action(async (address, amountStr, options) => {
    const zatoshis = BigInt(Math.round(parseFloat(amountStr) * 100000000));
    const client = createClient({
      endpoint: options.endpoint,
      network: 'regtest',
    });
    try {
      console.log(`Funding ${address} with ${amountStr} ZEC (${zatoshis} zatoshis)...`);
      const res = await dev.fund(client, address, zatoshis);
      console.log(`✅ Funded successfully. Txid: ${res.txid}`);
    } catch (err: any) {
      console.error('Funding failed:', err.message || err);
      process.exit(1);
    } finally {
      await client.close();
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

program.parse(process.argv);
