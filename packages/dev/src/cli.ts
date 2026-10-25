#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { createClient, dev, accountFromMnemonic } from '@zcash-app/sdk';

const REMOTE_ENDPOINTS: Record<string, string> = {
  regtest: '127.0.0.1:28137',
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};

const program = new Command();

program
  .name('zcash-dev')
  .description('Developer harness & regtest helper CLI for shielded Zcash apps')
  .version('0.1.0');

program
  .command('info')
  .description('Get node & indexer status')
  .option('-e, --endpoint <endpoint>', 'Zaino gRPC endpoint', '127.0.0.1:28137')
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
  .option('-e, --endpoint <endpoint>', 'Zaino gRPC endpoint', '127.0.0.1:28137')
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
  .option('-e, --endpoint <endpoint>', 'Zaino gRPC endpoint', '127.0.0.1:28137')
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
    let dashboardCwd = process.cwd();

    if (fs.existsSync(monorepoDashboard) && fs.existsSync(path.join(monorepoDashboard, 'package.json'))) {
      dashboardCwd = monorepoDashboard;
    }

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

const regtestCmd = program
  .command('regtest')
  .description('Regtest environment management commands');

regtestCmd
  .command('setup')
  .description('Configure and initialize regtest stack (pins images, creates account, sets miner_address & miner_memo)')
  .option('--z3-path <path>', 'Path to z3 repository', '')
  .action(async (options) => {
    let z3Dir = options.z3Path;
    if (!z3Dir) {
      const candidates = [
        path.resolve(process.cwd(), '../z3'),
        path.resolve(process.cwd(), 'z3'),
        '/Users/0xblackadam/Downloads/z3',
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'docker-compose.yml'))) {
          z3Dir = cand;
          break;
        }
      }
    }

    if (!z3Dir || !fs.existsSync(z3Dir)) {
      console.error('❌ Could not locate z3 directory. Please specify with --z3-path <path>');
      process.exit(1);
    }

    console.log(`\n=== 🛠️  Setting up Regtest in ${z3Dir} ===\n`);

    // 1. Pin images in .env.regtest
    const envRegtestPath = path.join(z3Dir, '.env.regtest');
    let envLines = fs.existsSync(envRegtestPath) ? fs.readFileSync(envRegtestPath, 'utf8').split('\n') : [];

    const setOrAddEnv = (key: string, value: string) => {
      let found = false;
      envLines = envLines.map((line) => {
        if (line.startsWith(`${key}=`)) {
          found = true;
          return `${key}=${value}`;
        }
        return line;
      });
      if (!found) {
        envLines.push(`${key}=${value}`);
      }
    };

    setOrAddEnv('Z3_ZEBRA_IMAGE', 'zfnd/zebra:7.0.0');
    setOrAddEnv('Z3_ZAINO_IMAGE', 'zingodevops/zainod:0.10.0-no-tls');
    fs.writeFileSync(envRegtestPath, envLines.join('\n'));
    console.log('✅ Pinned images in .env.regtest:');
    console.log('   - Z3_ZEBRA_IMAGE=zfnd/zebra:7.0.0');
    console.log('   - Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0-no-tls');

    // 2. Ensure docker stack is up
    console.log('\n🐳 Starting Z3 containers...');
    execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest up -d`, { stdio: 'inherit' });

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
    const zebraTomlPath = path.join(z3Dir, 'config/regtest/zebra.toml');
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
      console.log('\n✅ Updated config/regtest/zebra.toml:');
      console.log(`   - miner_address = "${accountUa}"`);
      console.log(`   - miner_memo = "regtest"`);
    }

    // Update .env.regtest mining variables
    setOrAddEnv('ZEBRA_MINING__MINER_ADDRESS', accountUa);
    setOrAddEnv('ZEBRA_MINING__MINER_MEMO', '72656774657374');
    fs.writeFileSync(envRegtestPath, envLines.join('\n'));

    // 6. Restart Zebra to apply mining configuration
    console.log('\n🔄 Restarting Zebra container with new mining config...');
    execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest up -d --force-recreate zebra`, { stdio: 'inherit' });

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
  .option('--z3-path <path>', 'Path to z3 repository', '')
  .option('-y, --yes', 'Confirm wiping regtest blockchain without interactive prompt')
  .option('--dry-run', 'Derive and print exact volumes/containers to be wiped without executing')
  .action(async (options) => {
    let z3Dir = options.z3Path;
    if (!z3Dir) {
      const candidates = [
        path.resolve(process.cwd(), '../z3'),
        path.resolve(process.cwd(), 'z3'),
        '/Users/0xblackadam/Downloads/z3',
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'docker-compose.yml'))) {
          z3Dir = cand;
          break;
        }
      }
    }

    if (!z3Dir || !fs.existsSync(z3Dir)) {
      console.error('❌ Could not locate z3 directory. Please specify with --z3-path <path>');
      process.exit(1);
    }

    // Safety check: Verify compose project is the regtest one
    const envRegtestPath = path.join(z3Dir, '.env.regtest');
    if (!fs.existsSync(envRegtestPath)) {
      console.error(`❌ Refusing to wipe: ${envRegtestPath} not found. Must be executed against a valid regtest project.`);
      process.exit(1);
    }

    const envContent = fs.readFileSync(envRegtestPath, 'utf8');
    const projectNameMatch = envContent.match(/^COMPOSE_PROJECT_NAME\s*=\s*(.+)$/m);
    const projectName = projectNameMatch ? projectNameMatch[1].trim() : '';
    if (projectName !== 'z3-regtest') {
      console.error(`❌ Refusing to wipe: Expected COMPOSE_PROJECT_NAME=z3-regtest, but found "${projectName}". Only regtest environments may be wiped.`);
      process.exit(1);
    }

    // Dynamically derive volumes and services from docker compose config at runtime
    let dynamicVolumes: string[] = [];
    let dynamicServices: string[] = [];
    try {
      const vOutput = execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest config --volumes`, { encoding: 'utf8' });
      dynamicVolumes = vOutput.split('\n').map((v: string) => v.trim()).filter(Boolean).map((v: string) => `${projectName}_${v}`);
    } catch (e: any) {
      dynamicVolumes = [`${projectName}_chain`, `${projectName}_zallet`, `${projectName}_cookie`, `${projectName}_zallet_ca_certificates`];
    }

    try {
      const sOutput = execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest config --services`, { encoding: 'utf8' });
      dynamicServices = sOutput.split('\n').map((s: string) => s.trim()).filter(Boolean);
    } catch (e: any) {
      dynamicServices = ['zebra', 'cookie-permissions', 'zallet', 'rpc-router'];
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
      console.log(`   1. docker compose --env-file .env.regtest down -v (purges volumes: ${dynamicVolumes.join(', ')}`);
      console.log('   2. bash scripts/regtest-init.sh (re-initializes genesis credentials and parameters)');
      console.log(`   3. docker compose --env-file .env.regtest up -d && docker compose --env-file .env.regtest up -d zaino`);
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

    console.log(`\n=== 🧹 Wiping Regtest Blockchain in ${z3Dir} ===\n`);
    execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest down -v`, { stdio: 'inherit' });
    console.log('\n=== 🛠️  Reinitializing fresh chain via regtest-init.sh ===\n');
    execSync(`cd "${z3Dir}" && bash scripts/regtest-init.sh`, { stdio: 'inherit' });
    execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest up -d && docker compose --env-file .env.regtest up -d zaino`, { stdio: 'inherit' });

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
      const zebraTomlPath = path.join(z3Dir, 'config/regtest/zebra.toml');
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

      const envRegtestPath = path.join(z3Dir, '.env.regtest');
      if (fs.existsSync(envRegtestPath)) {
        let envLines = fs.readFileSync(envRegtestPath, 'utf8').split('\n');
        const setOrAddEnv = (key: string, value: string) => {
          let found = false;
          envLines = envLines.map((line) => {
            if (line.startsWith(`${key}=`)) {
              found = true;
              return `${key}=${value}`;
            }
            return line;
          });
          if (!found) envLines.push(`${key}=${value}`);
        };
        setOrAddEnv('ZEBRA_MINING__MINER_ADDRESS', accountUa);
        setOrAddEnv('ZEBRA_MINING__MINER_MEMO', '72656774657374');
        fs.writeFileSync(envRegtestPath, envLines.join('\n'));
      }

      execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest up -d --force-recreate zebra`, { stdio: 'inherit' });
    }

    console.log('⏳ Waiting for Zebra RPC after restart...');
    await waitForRpc({ jsonrpc: '2.0', id: 1, method: 'getblockcount', params: [] });

    console.log('Mining 105 blocks for fresh regtest chain...');
    await fetch('http://127.0.0.1:8181', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'generate', params: [105] }),
    });
    execSync(`cd "${z3Dir}" && docker compose --env-file .env.regtest up -d zaino`, { stdio: 'inherit' });
    console.log('✅ Fresh regtest chain created with tip height 105!\n');
  });

program.parse(process.argv);
