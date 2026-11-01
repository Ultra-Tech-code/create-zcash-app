#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import { generateMnemonic, validateMnemonic, BIP39_WORDLIST } from './bip39';
import { redactSecretUrl } from './redact';

export { redactSecretUrl, validateMnemonic, BIP39_WORDLIST };

export const REMOTE_ENDPOINTS = {
  regtest: '127.0.0.1:28137',
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};

export const DEFAULT_ZEBRA_RPC = {
  regtest: 'http://127.0.0.1:18232',
  testnet: 'http://127.0.0.1:18232',
  mainnet: 'http://127.0.0.1:18232',
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

export function toPackageName(projectName: string): string {
  const cleaned = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return cleaned || 'my-zcash-app';
}

export function renderTemplate(content: string, replacements: Record<string, string>): string {
  let rendered = content;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
  }
  return rendered;
}

/**
 * Verifies that the project's .gitignore file explicitly ignores .env.local
 */
export function verifyGitignoreProtectsEnvLocal(projectDir: string): boolean {
  const gitignorePath = path.join(projectDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return false;
  }
  const content = fs.readFileSync(gitignorePath, 'utf8');
  const lines = content.split('\n').map((l) => l.trim());
  return lines.some((l) => l === '.env.local' || l === '.env*.local' || l === '*.local');
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

/**
 * Reads a mnemonic for import without accepting it as a CLI argument.
 * Sources allowed: hidden interactive prompt, stdin, or existing process env var ZCASH_MNEMONIC.
 */
export async function getMnemonicForImport(isInteractive: boolean): Promise<string> {
  if (process.env.ZCASH_MNEMONIC && process.env.ZCASH_MNEMONIC.trim()) {
    return process.env.ZCASH_MNEMONIC.trim();
  }
  if (!isInteractive || !process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => {
        const trimmed = data.trim();
        if (!trimmed) {
          reject(new Error('No mnemonic provided on stdin or ZCASH_MNEMONIC environment variable'));
        } else {
          resolve(trimmed);
        }
      });
      process.stdin.on('error', (err) => reject(err));
    });
  }

  const res = await prompts({
    type: 'password',
    name: 'mnemonic',
    message: 'Enter BIP-39 mnemonic phrase (hidden):',
  });
  if (!res.mnemonic || !res.mnemonic.trim()) {
    throw new Error('Import aborted: no mnemonic provided.');
  }
  return res.mnemonic.trim();
}

export function validateEndpoint(endpoint: string): void {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error('Endpoint cannot be empty.');
  }
  if (trimmed.includes('://')) {
    throw new Error('Use host:port for the gRPC endpoint (e.g. 127.0.0.1:28137)');
  }
  if (/\s/.test(trimmed)) {
    throw new Error(`Invalid endpoint "${trimmed}": contains whitespace.`);
  }
}

export function validateZebraRpc(urlStr: string): void {
  const trimmed = urlStr.trim();
  if (!trimmed) return;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid Zebra RPC protocol "${parsed.protocol}": must be http: or https:`);
    }
  } catch (err: any) {
    throw new Error(`Invalid Zebra RPC URL "${redactSecretUrl(trimmed)}": ${err.message}`);
  }
}

const program = new Command();

program
  .name('create-zcash-app')
  .description('Scaffold a shielded Zcash application powered by Z3 and @zcash-app/sdk')
  .argument('[project-name]', 'Name of the project directory')
  .option('-t, --template <template>', 'Template to use (nextjs-fullstack)', 'nextjs-fullstack')
  .option('-n, --network <network>', 'Network (regtest | testnet | mainnet)')
  .option('--remote', 'Use remote public RPC indexer without local node')
  .option('--key-source <source>', 'Key source (generate | import | ufvk | none)')
  .option('--ufvk <ufvk>', 'Unified Full Viewing Key for watch-only account')
  .option('--endpoint <endpoint>', 'lightwalletd/Zaino gRPC endpoint (host:port)')
  .option('--zebra-rpc <url>', 'Zebra JSON-RPC URL (http://host:port)')
  .option('--birthday <height>', 'Wallet birthday block height')
  .option('--account-index <index>', 'BIP-44 account index', '0')
  .option('--allow-mainnet-key-on-disk', 'Explicitly allow writing mainnet private key to disk (dangerous)')
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

    // 3. Prompt for Connection Mode & Endpoints
    let connectionMode: 'local' | 'remote' = 'local';
    let endpoint = options.endpoint;
    let zebraRpc = options.zebraRpc;

    if (network === 'regtest') {
      connectionMode = 'local';
      endpoint = endpoint || '127.0.0.1:28137';
      zebraRpc = zebraRpc || DEFAULT_ZEBRA_RPC.regtest;
    } else {
      if (options.remote) {
        connectionMode = 'remote';
        endpoint = endpoint || REMOTE_ENDPOINTS[network as 'testnet' | 'mainnet'];
        zebraRpc = zebraRpc || '';
      } else if (!endpoint) {
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
        zebraRpc = connectionMode === 'remote' ? '' : DEFAULT_ZEBRA_RPC[network as 'testnet' | 'mainnet'];
      } else {
        zebraRpc = zebraRpc || '';
      }
    }

    validateEndpoint(endpoint);
    if (zebraRpc) {
      validateZebraRpc(zebraRpc);
    }

    // 4. Prompt for Key Source
    let keySource = options.keySource;
    if (!keySource) {
      if (process.stdin.isTTY) {
        const keyResponse = await prompts({
          type: 'select',
          name: 'keySource',
          message: 'Key source for account derivation:',
          choices: [
            { title: '🔑 Generate — Create a new shielded mnemonic phrase', value: 'generate' },
            { title: '📥 Import — Import an existing BIP-39 recovery phrase', value: 'import' },
            { title: '👁️  UFVK — Watch-only account via Unified Full Viewing Key', value: 'ufvk' },
            { title: '🚫 None — Skip key setup for now (configure later)', value: 'none' },
          ],
          initial: 0,
        });
        keySource = keyResponse.keySource;
      } else {
        keySource = network === 'regtest' ? 'generate' : 'none';
      }
    }

    if (!['generate', 'import', 'ufvk', 'none'].includes(keySource)) {
      console.error(`Invalid key-source "${keySource}". Must be generate, import, ufvk, or none.`);
      process.exit(1);
    }

    let mnemonic: string | null = null;
    let ufvk: string | null = null;
    let shouldWriteKeyToDisk = true;

    if (keySource === 'generate') {
      mnemonic = generateMnemonic(24);
      if (network !== 'regtest') {
        console.log('\n================================================================================');
        console.log('⚠️  IMPORTANT: WRITE DOWN THIS RECOVERY PHRASE AND KEEP IT SECURE!');
        console.log('Do NOT share it with anyone. This is the ONLY way to recover your funds.');
        console.log('');
        console.log(mnemonic);
        console.log('================================================================================\n');
      }
    } else if (keySource === 'import') {
      try {
        mnemonic = await getMnemonicForImport(Boolean(process.stdin.isTTY));
      } catch (err: any) {
        console.error(err.message || String(err));
        process.exit(1);
      }
      if (!validateMnemonic(mnemonic)) {
        console.error('Invalid BIP-39 mnemonic (word count, wordlist or checksum)');
        process.exit(1);
      }
    } else if (keySource === 'ufvk') {
      ufvk = options.ufvk || '';
      if (!ufvk && process.stdin.isTTY) {
        const ufvkResponse = await prompts({
          type: 'text',
          name: 'ufvk',
          message: 'Enter Unified Full Viewing Key (uview...):',
        });
        ufvk = (ufvkResponse.ufvk || '').trim();
      } else if (!ufvk && process.env.ZCASH_UFVK) {
        ufvk = process.env.ZCASH_UFVK.trim();
      }
      if (!ufvk) {
        console.error('No UFVK provided for watch-only configuration.');
        process.exit(1);
      }
    }

    // Mainnet key policy: NEVER write mnemonic to disk by default
    if (network === 'mainnet' && (keySource === 'generate' || keySource === 'import')) {
      if (!options.allowMainnetKeyOnDisk) {
        shouldWriteKeyToDisk = false;
        console.log('⚠️  MAINNET SECURITY NOTICE: Mnemonics are not written to disk by default on mainnet.');
        console.log('To use this account in production, inject ZCASH_MNEMONIC into your server environment');
        console.log('or a secure secret manager (e.g., AWS Secrets Manager, Vault, etc.).\n');
      } else {
        if (process.stdin.isTTY) {
          const confirm = await prompts({
            type: 'text',
            name: 'typed',
            message: 'Type "I UNDERSTAND THE RISKS" to write mainnet private key to disk:',
          });
          if (confirm.typed !== 'I UNDERSTAND THE RISKS') {
            console.error('Scaffolding aborted: typed confirmation did not match.');
            process.exit(1);
          }
        }
        console.log('⚠️  WARNING: Writing mainnet private key to .env.local on disk as requested.');
        shouldWriteKeyToDisk = true;
      }
    }

    // 5. Prompt for Docker Compose if local
    let generateDockerCompose = false;
    if (connectionMode === 'local') {
      if (process.stdin.isTTY) {
        const dockerResponse = await prompts({
          type: 'confirm',
          name: 'compose',
          message: `Include pre-configured docker-compose.yml for Z3 stack (${network})?`,
          initial: true,
        });
        generateDockerCompose = dockerResponse.compose ?? false;
      } else {
        generateDockerCompose = network === 'regtest';
      }
    }

    if (mnemonic && keySource !== 'generate') {
      if (!validateMnemonic(mnemonic)) {
        console.error('Invalid BIP-39 mnemonic (word count, wordlist or checksum)');
        process.exit(1);
      }
    }

    console.log(`\n🚀 Scaffolding shielded Zcash app in ${targetDir}...`);

    // 6. Copy the Next.js template
    const cliVersion = readCliVersion();
    const sdkRange = `^${cliVersion}`;
    const writtenFiles = scaffoldTemplate(targetDir, {
      __PROJECT_NAME__: toPackageName(projectName),
      __SDK_RANGE__: sdkRange,
    });

    // 7. Verify generated .gitignore protects .env.local before writing any key
    if ((mnemonic || ufvk) && shouldWriteKeyToDisk) {
      const isProtected = verifyGitignoreProtectsEnvLocal(targetDir);
      if (!isProtected) {
        console.error('Security Error: Generated project .gitignore does not ignore .env.local. Refusing to write keys.');
        process.exit(1);
      }
    }

    // 8. Write .env.local (file mode 0600)
    const birthday = options.birthday ? options.birthday.trim() : '';
    const accountIndex = options.accountIndex ? options.accountIndex.trim() : '0';

    const envLocalLines = [
      '# create-zcash-app environment config',
      `ZCASH_NETWORK=${network}`,
      `ZCASH_ENDPOINT=${endpoint}`,
      `ZCASH_ZEBRA_RPC=${zebraRpc || ''}`,
      `ZCASH_BIRTHDAY=${birthday}`,
      `ZCASH_ACCOUNT_INDEX=${accountIndex}`,
    ];

    if (shouldWriteKeyToDisk && mnemonic) {
      envLocalLines.push(`ZCASH_MNEMONIC=${mnemonic}`);
    } else {
      envLocalLines.push('# ZCASH_MNEMONIC=');
    }

    if (ufvk) {
      envLocalLines.push(`ZCASH_UFVK=${ufvk}`);
    } else {
      envLocalLines.push('# ZCASH_UFVK=');
    }

    const envLocalPath = path.join(targetDir, '.env.local');
    fs.writeFileSync(envLocalPath, envLocalLines.join('\n') + '\n', { mode: 0o600 });
    try {
      fs.chmodSync(envLocalPath, 0o600);
    } catch {}
    writtenFiles.push('.env.local');

    // 9. Write committed .env.example (same keys, zero secrets)
    const envExampleLines = [
      '# create-zcash-app example environment config',
      `ZCASH_NETWORK=${network}`,
      `ZCASH_ENDPOINT=${redactSecretUrl(endpoint)}`,
      `ZCASH_ZEBRA_RPC=${redactSecretUrl(zebraRpc || '')}`,
      'ZCASH_BIRTHDAY=',
      `ZCASH_ACCOUNT_INDEX=${accountIndex}`,
      '# Provide either ZCASH_MNEMONIC (full spend) or ZCASH_UFVK (watch-only).',
      '# Never commit your private keys or .env.local to version control.',
      'ZCASH_MNEMONIC=',
      'ZCASH_UFVK=',
    ];
    const envExamplePath = path.join(targetDir, '.env.example');
    fs.writeFileSync(envExamplePath, envExampleLines.join('\n') + '\n');
    writtenFiles.push('.env.example');

    // 10. Write zcash.config.json
    const configData = {
      network,
      connectionMode,
      endpoint: redactSecretUrl(endpoint),
      zebraRpc: zebraRpc ? redactSecretUrl(zebraRpc) : '',
      keySource,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(targetDir, 'zcash.config.json'),
      JSON.stringify(configData, null, 2)
    );
    writtenFiles.push('zcash.config.json');

    // 11. Optionally generate docker-compose.yml for local Z3
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

    // 12. Write README.md with instructions
    const readmeContent = `# ${projectName}

Shielded Zcash application configured for **${network}** (${connectionMode} indexer).
Built on \`@zcash-app/sdk@${sdkRange}\` and \`zcash-dev@${sdkRange}\`.

## What is in the project

- \`app/page.tsx\` — home page that shows the account's Unified Address and balance.
- \`app/api/account/route.ts\` — server route using \`@zcash-app/sdk\`: \`accountFromMnemonic\`,
  \`accountFromUfvk\`, \`createClient\` and \`getBalance\`.
- \`zcash.config.json\` — the network, connection mode and indexer endpoint you selected.
- \`.env.local\` — environment variables containing your network, endpoints, and credentials (mode 0600).
- \`.env.example\` — committed template showing all configuration variables without secrets.

## Keys and RPC Configuration

Configuration is managed via environment variables in \`.env.local\` (local overrides) or your hosting platform / secret manager:

- \`ZCASH_NETWORK\`: The target Zcash network (\`regtest\`, \`testnet\`, or \`mainnet\`).
- \`ZCASH_ENDPOINT\`: The gRPC endpoint for the Zaino or lightwalletd indexer (\`host:port\`).
- \`ZCASH_ZEBRA_RPC\`: The HTTP JSON-RPC endpoint for Zebra (\`http://host:port\`).
- \`ZCASH_BIRTHDAY\`: Earliest block height to scan. Set to your account creation block to speed up balance scans.
- \`ZCASH_ACCOUNT_INDEX\`: BIP-44 account index (defaults to \`0\`).
- \`ZCASH_MNEMONIC\`: 24-word BIP-39 recovery phrase (grants full spend authority).
- \`ZCASH_UFVK\`: Unified Full Viewing Key (\`uview...\`) for watch-only balance inspection without spending authority.

### Testnet vs. Mainnet Guidance

- **Testnet**: Designed for public integration testing with testnet ZEC (TAZ). Ideal for developing and staging applications before production.
- **Mainnet (Experimental)**: Uses real ZEC with real monetary value. **Never write or commit mainnet private keys to disk.** In production, inject \`ZCASH_MNEMONIC\` via your platform's environment variables or a dedicated secret manager (e.g., AWS Secrets Manager, Google Secret Manager, Vault).
- **Watch-Only Mode**: In server environments that only need to display addresses or monitor incoming payments, configure \`ZCASH_UFVK\` instead of \`ZCASH_MNEMONIC\` to eliminate the risk of key exposure.
- **Never Commit Secrets**: Ensure \`.env.local\` is listed in \`.gitignore\` and never committed to version control.

## Getting Started

${
  generateDockerCompose
    ? `1. **Start the local Z3 stack**:
   \`\`\`bash
   docker compose up -d
   \`\`\`
`
    : `1. **Connected to ${connectionMode} indexer**: \`${redactSecretUrl(endpoint)}\`
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
`;
    fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);
    writtenFiles.push('README.md');

    console.log(`\n🎉 Success! Created ${projectName} at ${targetDir}`);
    console.log(`   Configured Network: ${network} (${connectionMode})`);
    console.log(`   Indexer Endpoint:   ${redactSecretUrl(endpoint)}`);
    if (zebraRpc) {
      console.log(`   Zebra RPC:          ${redactSecretUrl(zebraRpc)}`);
    }
    console.log(`   Key Source:         ${keySource}`);
    console.log(`   Package range:      @zcash-app/sdk@${sdkRange}, zcash-dev@${sdkRange}`);
    console.log(`   Files written:      ${writtenFiles.length}`);
    console.log(`\nNext steps:`);
    console.log(`   cd ${projectName}`);
    console.log(`   pnpm install`);
    console.log(`   pnpm dev\n`);
  });

export { program };

if (require.main === module) {
  program.parse();
}
