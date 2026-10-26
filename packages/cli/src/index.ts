#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';

export const REMOTE_ENDPOINTS = {
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};

const program = new Command();

program
  .name('create-zcash-app')
  .description('Scaffold a shielded Zcash application powered by Z3 and @zcash-app/sdk')
  .argument('[project-name]', 'Name of the project directory')
  .option('-t, --template <template>', 'Template to use (nextjs-fullstack | express-api | scanner)', 'nextjs-fullstack')
  .option('-n, --network <network>', 'Network (regtest | testnet | mainnet)')
  .option('--remote', 'Use remote public RPC indexer without local node')
  .action(async (projectNameArg, options) => {
    let projectName = projectNameArg;

    // 1. Prompt for project name if not supplied
    if (!projectName) {
      const response = await prompts({
        type: 'text',
        name: 'name',
        message: 'What is your project name?',
        initial: 'my-zcash-app',
      });
      projectName = response.name;
    }

    if (!projectName) {
      console.log('Project scaffolding aborted.');
      process.exit(1);
    }

    const targetDir = path.resolve(process.cwd(), projectName);
    if (fs.existsSync(targetDir)) {
      console.error(`Directory "${projectName}" already exists!`);
      process.exit(1);
    }

    // 2. Prompt for Network if not provided
    let network = options.network;
    if (!network) {
      const netResponse = await prompts({
        type: 'select',
        name: 'network',
        message: 'Which Zcash network do you want to start with?',
        choices: [
          {
            title: '🟢 regtest (Recommended for dev — instant block mining, auto-faucet, 100% offline)',
            value: 'regtest',
          },
          {
            title: '🔵 testnet (Public staging with testnet ZEC/TAZ)',
            value: 'testnet',
          },
          {
            title: '🟠 mainnet (Production with real ZEC)',
            value: 'mainnet',
          },
        ],
        initial: 0,
      });
      network = netResponse.network;
    }

    if (!network) {
      console.log('Scaffolding aborted.');
      process.exit(1);
    }

    // 3. Prompt for Connection Mode if testnet/mainnet
    let connectionMode: 'local' | 'remote' = 'local';
    let endpoint = '127.0.0.1:8137';

    if (network === 'regtest') {
      connectionMode = 'local';
      endpoint = '127.0.0.1:28137';
    } else {
      if (options.remote) {
        connectionMode = 'remote';
        endpoint = REMOTE_ENDPOINTS[network as 'testnet' | 'mainnet'];
      } else {
        const modeResponse = await prompts({
          type: 'select',
          name: 'mode',
          message: `How do you want to connect to ${network}?`,
          choices: [
            {
              title: `🌐 Remote Public Indexer (${REMOTE_ENDPOINTS[network as 'testnet' | 'mainnet']}) — Zero install, no node required`,
              value: 'remote',
            },
            {
              title: `🐳 Local Z3 Node (Docker: Zebra + Zaino) — Full self-hosted privacy`,
              value: 'local',
            },
          ],
          initial: 0,
        });
        connectionMode = modeResponse.mode;
        endpoint =
          connectionMode === 'remote'
            ? REMOTE_ENDPOINTS[network as 'testnet' | 'mainnet']
            : '127.0.0.1:8137';
      }
    }

    // 4. Prompt for Docker Compose if local
    let generateDockerCompose = false;
    if (connectionMode === 'local') {
      const dockerResponse = await prompts({
        type: 'confirm',
        name: 'compose',
        message: `Include pre-configured docker-compose.yml for Z3 stack (${network})?`,
        initial: true,
      });
      generateDockerCompose = dockerResponse.compose;
    }

    console.log(`\n🚀 Scaffolding shielded Zcash app in ${targetDir}...`);
    fs.mkdirSync(targetDir, { recursive: true });

    // 5. Create scaffolded package.json
    const packageJson = {
      name: projectName,
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        dashboard: 'zcash-dev dashboard',
        mine: 'zcash-dev mine',
        fund: 'zcash-dev fund',
        switch: 'zcash-dev switch',
      },
      dependencies: {
        '@zcash-app/sdk': '^0.1.0',
        next: '^14.2.0',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {
        'zcash-dev': '^0.1.0',
        typescript: '^5.6.3',
        '@types/node': '^20.0.0',
        '@types/react': '^18.3.0',
      },
    };
    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // 6. Write zcash.config.json
    const configData = {
      network,
      connectionMode,
      endpoint,
      zainoPin: 'zingodevops/zainod:0.10.0-no-tls',
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(targetDir, 'zcash.config.json'),
      JSON.stringify(configData, null, 2)
    );

    // 7. Write .env.local
    const envContent = `# create-zcash-app environment config
ZCASH_NETWORK=${network}
ZCASH_CONNECTION_MODE=${connectionMode}
ZCASH_ENDPOINT=${endpoint}

# Z3 Stack Pin Override: Zaino >= 0.10.0 required for Ironwood support
Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0-no-tls
`;
    fs.writeFileSync(path.join(targetDir, '.env.local'), envContent);

    // 8. Optionally generate docker-compose.yml for local Z3
    if (generateDockerCompose) {
      const composeContent = `services:
  zebra:
    image: zfnd/zebra:7.0.0
    restart: unless-stopped
    ports:
      - "8181:8181"
      - "18232:18232"
    environment:
      - NETWORK=${network}

  zaino:
    image: zingodevops/zainod:0.10.0-no-tls
    restart: unless-stopped
    ports:
      - "${network === 'regtest' ? '28137:28137' : '8137:8137'}"
    depends_on:
      - zebra
    environment:
      - ZAINO_ZEBRA_RPC=http://zebra:18232
`;
      fs.writeFileSync(path.join(targetDir, 'docker-compose.yml'), composeContent);
    }

    // 9. Write README.md with instructions
    const readmeContent = `# ${projectName}

Shielded Zcash application configured for **${network}** (${connectionMode} indexer).

## Getting Started

${
  generateDockerCompose
    ? `1. **Start the local Z3 stack**:
   \`\`\`bash
   docker compose up -d
   \`\`\`
`
    : `1. **Connected to ${connectionMode} indexer**: \`${endpoint}\`
`
}
2. **Run your development app**:
   \`\`\`bash
   npm run dev
   # or pnpm dev
   \`\`\`

3. **Open the Developer Dashboard**:
   Inspect real-time balances, diversified Unified Addresses, and incoming notes:
   \`\`\`bash
   npm run dashboard
   \`\`\`

4. **Switch networks anytime**:
   When you're ready to deploy to testnet or mainnet, run:
   \`\`\`bash
   npx zcash-dev switch testnet
   # or
   npx zcash-dev switch mainnet --remote
   \`\`\`
`;
    fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);

    console.log(`\n🎉 Success! Created ${projectName} at ${targetDir}`);
    console.log(`   Configured Network: ${network} (${connectionMode})`);
    console.log(`   Indexer Endpoint:   ${endpoint}`);
    console.log(`\nNext steps:`);
    console.log(`   cd ${projectName}`);
    console.log(`   npm install`);
    if (generateDockerCompose) {
      console.log(`   docker compose up -d`);
    }
    console.log(`   npm run dev\n`);
  });

program.parse(process.argv);
