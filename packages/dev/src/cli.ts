#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import { createClient, dev, accountFromMnemonic } from '@zcash-app/sdk';

const REMOTE_ENDPOINTS: Record<string, string> = {
  regtest: '127.0.0.1:8137',
  testnet: 'zcash-testnet.zec.rocks:443',
  mainnet: 'zcash-mainnet.zec.rocks:443',
};

const program = new Command();

program
  .name('zcash-dev')
  .description('Developer harness & regtest helper CLI for shielded Zcash apps')
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
    let endpoint = '127.0.0.1:8137';

    if (targetNetwork === 'regtest') {
      connectionMode = 'local';
      endpoint = '127.0.0.1:8137';
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
Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0
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

program.parse(process.argv);
