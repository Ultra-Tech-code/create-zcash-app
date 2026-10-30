#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';

export const REMOTE_ENDPOINTS = {
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};

/**
 * The scaffolder and the packages it depends on are released together, so the ranges written into
 * a new project are derived from this package's own version instead of a hard-coded literal.
 */
export function readCliVersion(): string {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`Could not read create-zcash-app's version from ${packageJsonPath}`);
  }
  return parsed.version;
}

function toPackageName(projectName: string): string {
  const cleaned = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return cleaned || 'my-zcash-app';
}

function renderTemplate(content: string, replacements: Record<string, string>): string {
  let rendered = content;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
  }
  return rendered;
}

/**
 * Copies packages/cli/template into the new project, renaming `*.tmpl` files (so `package.json`
 * does not act as a package manifest inside this repo) and substituting the placeholders.
 */
export function scaffoldTemplate(
  targetDir: string,
  replacements: Record<string, string>
): string[] {
  const templateDir = path.resolve(__dirname, '..', 'template');
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template directory missing: ${templateDir}`);
  }

  const written: string[] = [];

  const walk = (srcDir: string, destDir: string) => {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const src = path.join(srcDir, entry.name);
      if (entry.isDirectory()) {
        walk(src, path.join(destDir, entry.name));
        continue;
      }
      const destName =
        entry.name === 'gitignore.tmpl'
          ? '.gitignore'
          : entry.name.endsWith('.tmpl')
            ? entry.name.slice(0, -'.tmpl'.length)
            : entry.name;
      const dest = path.join(destDir, destName);
      fs.writeFileSync(dest, renderTemplate(fs.readFileSync(src, 'utf8'), replacements));
      written.push(path.relative(targetDir, dest));
    }
  };

  walk(templateDir, targetDir);
  return written;
}

const program = new Command();

program
  .name('create-zcash-app')
  .description('Scaffold a shielded Zcash application powered by Z3 and @zcash-app/sdk')
  .argument('[project-name]', 'Name of the project directory')
  .option('-t, --template <template>', 'Template to use (nextjs-fullstack)', 'nextjs-fullstack')
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
            title: '🟢 regtest (Default - NU7 standalone chain, instant mining & faucet)',
            value: 'regtest',
          },
          {
            title: '🔵 testnet (Public staging with testnet ZEC/TAZ)',
            value: 'testnet',
          },
          {
            title: '🟠 mainnet (⚠️ Experimental - production with real ZEC)',
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

    // 5. Copy the Next.js template, substituting the project name and the released versions
    const cliVersion = readCliVersion();
    const sdkRange = `^${cliVersion}`;
    const writtenFiles = scaffoldTemplate(targetDir, {
      __PROJECT_NAME__: toPackageName(projectName),
      __SDK_RANGE__: sdkRange,
    });

    // 6. Write zcash.config.json
    const configData = {
      network,
      connectionMode,
      endpoint,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(targetDir, 'zcash.config.json'),
      JSON.stringify(configData, null, 2)
    );
    writtenFiles.push('zcash.config.json');

    // 7. Write .env.local
    const envContent = `# create-zcash-app environment config
ZCASH_NETWORK=${network}
ZCASH_CONNECTION_MODE=${connectionMode}
ZCASH_ENDPOINT=${endpoint}
# Set a BIP-39 mnemonic to keep a stable account across server restarts. Without it the app
# derives an address from a mnemonic generated in memory on each server start.
# ZCASH_MNEMONIC=
# First height to scan when reading a balance. Omit to scan from the pool activation height.
# ZCASH_BIRTHDAY=
`;
    fs.writeFileSync(path.join(targetDir, '.env.local'), envContent);
    writtenFiles.push('.env.local');

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
      writtenFiles.push('docker-compose.yml');
    }

    // 9. Write README.md with instructions
    const readmeContent = `# ${projectName}

Shielded Zcash application configured for **${network}** (${connectionMode} indexer).
Built on \`@zcash-app/sdk@${sdkRange}\` and \`zcash-dev@${sdkRange}\`.

## What is in the project

- \`app/page.tsx\` — home page that shows the account's Unified Address and balance.
- \`app/api/account/route.ts\` — server route using \`@zcash-app/sdk\`: \`accountFromMnemonic\`,
  \`createClient\` and \`getBalance\`.
- \`zcash.config.json\` — the network, connection mode and indexer endpoint you selected.
- \`.env.local\` — the same settings as environment variables, read by the server route.

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
2. **Install and run your development app**:
   \`\`\`bash
   pnpm install
   pnpm dev
   \`\`\`

3. **Open the Developer Dashboard**:
   Inspect real-time balances, diversified Unified Addresses, and incoming notes:
   \`\`\`bash
   pnpm dashboard
   \`\`\`

4. **Switch networks anytime**:
   When you're ready to deploy to testnet or mainnet, run:
   \`\`\`bash
   npx zcash-dev switch testnet
   # or
   npx zcash-dev switch mainnet --remote
   \`\`\`

## Notes

- Without \`ZCASH_MNEMONIC\` the server route derives an address from a mnemonic generated in
  memory, so the address changes when the server restarts.
- Without \`ZCASH_BIRTHDAY\` the balance scan starts at the pool activation height, which is slow on
  a public chain. Set a birthday to scan only recent blocks.
`;
    fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);
    writtenFiles.push('README.md');

    console.log(`\n🎉 Success! Created ${projectName} at ${targetDir}`);
    console.log(`   Configured Network: ${network} (${connectionMode})`);
    console.log(`   Indexer Endpoint:   ${endpoint}`);
    console.log(`   Package range:      @zcash-app/sdk@${sdkRange}, zcash-dev@${sdkRange}`);
    console.log(`   Files written:      ${writtenFiles.length}`);
    console.log(`\nNext steps:`);
    console.log(`   cd ${projectName}`);
    console.log(`   pnpm install`);
    if (generateDockerCompose) {
      console.log(`   docker compose up -d`);
    }
    console.log(`   pnpm dev\n`);
  });

program.parse(process.argv);
