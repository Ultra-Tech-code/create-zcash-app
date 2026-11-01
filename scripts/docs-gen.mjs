import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_SRC = path.join(REPO_ROOT, 'docs', 'src');
const REF_DIR = path.join(DOCS_SRC, 'reference');

// Ensure directories exist
fs.mkdirSync(REF_DIR, { recursive: true });

/**
 * 1. Synchronize known-issues.md from root KNOWN_ISSUES.md
 */
export function generateKnownIssues() {
  const rootKnownIssuesPath = path.join(REPO_ROOT, 'KNOWN_ISSUES.md');
  const targetPath = path.join(DOCS_SRC, 'known-issues.md');
  if (!fs.existsSync(rootKnownIssuesPath)) {
    throw new Error(`Root KNOWN_ISSUES.md not found at ${rootKnownIssuesPath}`);
  }
  const content = fs.readFileSync(rootKnownIssuesPath, 'utf8');
  const banner = `<!-- Generated automatically by pnpm docs:gen from KNOWN_ISSUES.md. Do not edit directly. -->\n\n`;
  fs.writeFileSync(targetPath, banner + content);
  console.log('✅ Generated docs/src/known-issues.md');
}

/**
 * 2. Generate scaffolder.md from packages/cli commander program
 */
export async function generateScaffolderRef() {
  const targetPath = path.join(REF_DIR, 'scaffolder.md');
  const cliDistPath = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
  if (!fs.existsSync(cliDistPath)) {
    throw new Error(`create-zcash-app dist not found at ${cliDistPath}. Run 'pnpm --filter create-zcash-app build' first.`);
  }

  const { program, readCliVersion, REMOTE_ENDPOINTS, DEFAULT_ZEBRA_RPC } = await import(cliDistPath);
  const version = typeof readCliVersion === 'function' ? readCliVersion() : '0.1.0';

  let md = `<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->\n\n`;
  md += `# Scaffolder CLI Reference (\`create-zcash-app\`)\n\n`;
  md += `The \`create-zcash-app\` CLI bootstraps new production-ready shielded Zcash applications with Next.js App Router, Tailwind CSS, TypeScript, and the \`@zcash-app/sdk\`.\n\n`;
  md += `**CLI Version**: \`${version}\` (as of November 2026)\n\n`;

  md += `## Synopsis\n\n`;
  md += `\`\`\`bash\n`;
  md += `npx create-zcash-app [project-name] [options]\n`;
  md += `\`\`\`\n\n`;

  md += `## Arguments\n\n`;
  md += `| Argument | Description | Default |\n`;
  md += `| :--- | :--- | :--- |\n`;
  md += `| \`[project-name]\` | Name of the directory to create and initialize | Prompts interactively (default: \`my-zcash-app\`) |\n\n`;

  md += `## Options & Flags\n\n`;
  md += `| Option | Description | Default / Fallback |\n`;
  md += `| :--- | :--- | :--- |\n`;

  for (const opt of program.options) {
    const flags = `\`${opt.flags}\``;
    const desc = opt.description.replace(/\|/g, '\\|');
    const def = opt.defaultValue !== undefined ? `\`${opt.defaultValue}\`` : 'None (interactive prompt)';
    md += `| ${flags} | ${desc} | ${def} |\n`;
  }

  md += `\n## Default Network Endpoints\n\n`;
  md += `When options are omitted, \`create-zcash-app\` defaults to the following endpoints based on selected network:\n\n`;
  md += `| Network | Default gRPC Endpoint (\`ZCASH_ENDPOINT\`) | Default Zebra JSON-RPC (\`ZCASH_ZEBRA_RPC\`) |\n`;
  md += `| :--- | :--- | :--- |\n`;
  md += `| \`regtest\` | \`${REMOTE_ENDPOINTS.regtest}\` | \`${DEFAULT_ZEBRA_RPC.regtest}\` |\n`;
  md += `| \`testnet\` | \`${REMOTE_ENDPOINTS.testnet}\` | \`${DEFAULT_ZEBRA_RPC.testnet}\` |\n`;
  md += `| \`mainnet\` | \`${REMOTE_ENDPOINTS.mainnet}\` | \`${DEFAULT_ZEBRA_RPC.mainnet}\` |\n\n`;

  md += `## Key Management Rules & Redaction\n\n`;
  md += `- **No Secret URLs in Public Config**: \`zcash.config.json\` stores only redacted URLs (via \`redactSecretUrl\`). Unredacted RPC URLs with secret tokens are stored strictly in \`.env.local\`.\n`;
  md += `- **BIP-39 Validation**: Any mnemonic provided via stdin or \`ZCASH_MNEMONIC\` is strictly validated with \`validateMnemonic\` (checking 12/24 word count, valid BIP-39 wordlist, and valid SHA-256 checksum) before any project directory or configuration is written.\n`;
  md += `- **Mainnet Safety Boundary**: Writing a mainnet private spending key to disk requires passing \`--allow-mainnet-key-on-disk\`. Otherwise, mainnet scaffolding defaults to watch-only UFVK mode or interactive keyless setup.\n`;

  fs.writeFileSync(targetPath, md);
  console.log('✅ Generated docs/src/reference/scaffolder.md');
}

/**
 * 3. Generate zcash-dev.md from packages/dev commander program tree
 */
export async function generateZcashDevRef() {
  const targetPath = path.join(REF_DIR, 'zcash-dev.md');
  const devDistPath = path.join(REPO_ROOT, 'packages', 'dev', 'dist', 'cli.js');
  if (!fs.existsSync(devDistPath)) {
    throw new Error(`zcash-dev dist not found at ${devDistPath}. Run 'pnpm --filter zcash-dev build' first.`);
  }

  const { program, readOwnVersion } = await import(devDistPath);
  const version = typeof readOwnVersion === 'function' ? readOwnVersion() : '0.1.0';

  let md = `<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->\n\n`;
  md += `# zcash-dev CLI Reference\n\n`;
  md += `\`zcash-dev\` is the developer harness, regtest orchestrator, and operational CLI for shielded Zcash applications.\n\n`;
  md += `**CLI Version**: \`${version}\` (as of November 2026)\n\n`;

  md += `## Overview of Commands\n\n`;
  md += `| Command | Description |\n`;
  md += `| :--- | :--- |\n`;

  for (const cmd of program.commands) {
    md += `| [\`zcash-dev ${cmd.name()}\`](#${cmd.name()}) | ${cmd.description().replace(/\|/g, '\\|')} |\n`;
  }

  md += `\n---\n\n`;

  for (const cmd of program.commands) {
    const cmdName = cmd.name();
    md += `## \`${cmdName}\`\n\n`;
    md += `${cmd.description()}\n\n`;

    const subcommands = cmd.commands || [];
    if (subcommands.length > 0) {
      md += `### Subcommands\n\n`;
      for (const sub of subcommands) {
        md += `#### \`zcash-dev ${cmdName} ${sub.name()}\`\n\n`;
        md += `${sub.description()}\n\n`;
        const alias = sub.alias();
        if (alias) {
          md += `**Alias**: \`${alias}\`\n\n`;
        }

        const args = sub._args || [];
        if (args.length > 0) {
          md += `**Arguments**:\n\n`;
          md += `| Argument | Description | Required |\n`;
          md += `| :--- | :--- | :--- |\n`;
          for (const a of args) {
            md += `| \`${a.name()}\` | ${a.description || 'Argument'} | ${a.required ? 'Yes' : 'No'} |\n`;
          }
          md += `\n`;
        }

        const opts = sub.options || [];
        if (opts.length > 0) {
          md += `**Options**:\n\n`;
          md += `| Option | Description | Default |\n`;
          md += `| :--- | :--- | :--- |\n`;
          for (const o of opts) {
            const def = o.defaultValue !== undefined ? `\`${o.defaultValue}\`` : 'None';
            md += `| \`${o.flags}\` | ${o.description.replace(/\|/g, '\\|')} | ${def} |\n`;
          }
          md += `\n`;
        }
      }
    } else {
      const args = cmd._args || [];
      if (args.length > 0) {
        md += `### Arguments\n\n`;
        md += `| Argument | Description | Required |\n`;
        md += `| :--- | :--- | :--- |\n`;
        for (const a of args) {
          md += `| \`${a.name()}\` | ${a.description || 'Argument'} | ${a.required ? 'Yes' : 'No'} |\n`;
        }
        md += `\n`;
      }

      const opts = cmd.options || [];
      if (opts.length > 0) {
        md += `### Options\n\n`;
        md += `| Option | Description | Default |\n`;
        md += `| :--- | :--- | :--- |\n`;
        for (const o of opts) {
          const def = o.defaultValue !== undefined ? `\`${o.defaultValue}\`` : 'None';
          md += `| \`${o.flags}\` | ${o.description.replace(/\|/g, '\\|')} | ${def} |\n`;
        }
        md += `\n`;
      }
    }
    md += `---\n\n`;
  }

  fs.writeFileSync(targetPath, md);
  console.log('✅ Generated docs/src/reference/zcash-dev.md');
}

/**
 * 4. Generate sdk.md from packages/sdk TypeScript declaration files
 */
export async function generateSdkRef() {
  const targetPath = path.join(REF_DIR, 'sdk.md');
  const dtsPath = path.join(REPO_ROOT, 'packages', 'sdk', 'dist', 'index.d.ts');
  if (!fs.existsSync(dtsPath)) {
    throw new Error(`SDK declaration file not found at ${dtsPath}. Run 'pnpm --filter @zcash-app/sdk build' first.`);
  }

  const program = ts.createProgram([dtsPath], {});
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(dtsPath);
  if (!sourceFile) {
    throw new Error(`Could not parse source file for ${dtsPath}`);
  }

  const modSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!modSymbol) {
    throw new Error(`Could not load module symbol for ${dtsPath}`);
  }

  const exports = checker.getExportsOfModule(modSymbol);

  let md = `<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->\n\n`;
  md += `# TypeScript SDK Reference (\`@zcash-app/sdk\`)\n\n`;
  md += `The \`@zcash-app/sdk\` package provides client connections, wallet synchronization, balance calculation, note decryption, and transaction construction for shielded Zcash applications.\n\n`;
  md += `**Package Version**: \`0.1.0\` (as of November 2026)\n\n`;

  const classes = [];
  const functions = [];
  const interfaces = [];
  const types = [];
  const constants = [];

  for (const exp of exports) {
    const name = exp.getName();
    const declaration = exp.valueDeclaration || exp.declarations?.[0];
    const doc = ts.displayPartsToString(exp.getDocumentationComment(checker));

    if (!declaration) continue;

    const kind = declaration.kind;
    if (kind === ts.SyntaxKind.ClassDeclaration) {
      classes.push({ name, doc, exp, declaration });
    } else if (kind === ts.SyntaxKind.FunctionDeclaration || kind === ts.SyntaxKind.MethodDeclaration) {
      functions.push({ name, doc, exp, declaration });
    } else if (kind === ts.SyntaxKind.InterfaceDeclaration) {
      interfaces.push({ name, doc, exp, declaration });
    } else if (kind === ts.SyntaxKind.TypeAliasDeclaration) {
      types.push({ name, doc, exp, declaration });
    } else if (kind === ts.SyntaxKind.VariableDeclaration) {
      const type = checker.getTypeOfSymbolAtLocation(exp, declaration);
      const callSignatures = type.getCallSignatures();
      if (callSignatures.length > 0) {
        functions.push({ name, doc, exp, declaration, signature: checker.typeToString(type) });
      } else {
        constants.push({ name, doc, exp, declaration, typeString: checker.typeToString(type) });
      }
    } else {
      constants.push({ name, doc, exp, declaration });
    }
  }

  md += `## Table of Contents\n\n`;
  md += `- [Classes](#classes)\n`;
  md += `- [Core Functions](#core-functions)\n`;
  md += `- [Interfaces](#interfaces)\n`;
  md += `- [Type Aliases](#type-aliases)\n`;
  md += `- [Constants](#constants)\n\n`;

  md += `## Classes\n\n`;
  for (const item of classes) {
    md += `### \`class ${item.name}\`\n\n`;
    if (item.doc) md += `${item.doc}\n\n`;
    const type = checker.getTypeOfSymbolAtLocation(item.exp, item.declaration);
    const properties = checker.getPropertiesOfType(type);
    if (properties.length > 0) {
      md += `**Members & Methods**:\n\n`;
      md += `| Member | Type / Description |\n`;
      md += `| :--- | :--- |\n`;
      for (const prop of properties.slice(0, 15)) {
        const propType = checker.getTypeOfSymbolAtLocation(prop, item.declaration);
        const propDoc = ts.displayPartsToString(prop.getDocumentationComment(checker));
        md += `| \`${prop.getName()}\` | \`${checker.typeToString(propType).replace(/\|/g, '\\|')}\` ${propDoc ? `— ${propDoc}` : ''} |\n`;
      }
      md += `\n`;
    }
  }

  md += `## Core Functions\n\n`;
  for (const item of functions) {
    md += `### \`${item.name}()\`\n\n`;
    if (item.doc) md += `${item.doc}\n\n`;
    const type = checker.getTypeOfSymbolAtLocation(item.exp, item.declaration);
    const sigs = type.getCallSignatures();
    if (sigs.length > 0) {
      const sigStr = checker.signatureToString(sigs[0]);
      md += `\`\`\`typescript\nfunction ${item.name}${sigStr};\n\`\`\`\n\n`;
    } else if (item.signature) {
      md += `\`\`\`typescript\nconst ${item.name}: ${item.signature};\n\`\`\`\n\n`;
    }
  }

  md += `## Interfaces\n\n`;
  for (const item of interfaces) {
    md += `### \`interface ${item.name}\`\n\n`;
    if (item.doc) md += `${item.doc}\n\n`;
    const type = checker.getTypeOfSymbolAtLocation(item.exp, item.declaration);
    const properties = checker.getPropertiesOfType(type);
    if (properties.length > 0) {
      md += `| Property | Type | Description |\n`;
      md += `| :--- | :--- | :--- |\n`;
      for (const prop of properties) {
        const propType = checker.getTypeOfSymbolAtLocation(prop, item.declaration);
        const propDoc = ts.displayPartsToString(prop.getDocumentationComment(checker));
        md += `| \`${prop.getName()}\` | \`${checker.typeToString(propType).replace(/\|/g, '\\|')}\` | ${propDoc || '—'} |\n`;
      }
      md += `\n`;
    }
  }

  md += `## Type Aliases\n\n`;
  for (const item of types) {
    const type = checker.getTypeOfSymbolAtLocation(item.exp, item.declaration);
    md += `### \`type ${item.name}\`\n\n`;
    if (item.doc) md += `${item.doc}\n\n`;
    md += `\`\`\`typescript\ntype ${item.name} = ${checker.typeToString(type)};\n\`\`\`\n\n`;
  }

  md += `## Constants\n\n`;
  for (const item of constants) {
    md += `### \`${item.name}\`\n\n`;
    if (item.doc) md += `${item.doc}\n\n`;
    if (item.typeString) {
      md += `Type: \`${item.typeString}\`\n\n`;
    }
  }

  fs.writeFileSync(targetPath, md);
  console.log('✅ Generated docs/src/reference/sdk.md');
}

/**
 * 5. Generate dashboard-api.md
 */
export async function generateDashboardApiRef() {
  const targetPath = path.join(REF_DIR, 'dashboard-api.md');

  let md = `<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->\n\n`;
  md += `# Developer Dashboard API Reference\n\n`;
  md += `The Zcash Developer Dashboard runs as a Next.js App Router service on port 3050 (default) and provides administrative, monitoring, and RPC endpoints for local and staging development.\n\n`;

  md += `## Security Model\n\n`;
  md += `- **Origin Verification (\`verifySameOrigin\`)**: All state-modifying POST endpoints require valid matching \`Origin\` and \`Host\` headers to mitigate Cross-Site Request Forgery (CSRF).\n`;
  md += `- **Endpoint Allowlisting (\`resolveAllowedEndpoint\`)**: Endpoints queried through proxy routes must exist in the recognized preset allowlist or match loopback/private ranges.\n`;
  md += `- **Secret Redaction (\`redactSecretUrl\`)**: JSON responses redact sensitive tokens in RPC URLs and sanitize errors to never echo mnemonics or credentials.\n\n`;

  md += `## API Endpoints\n\n`;

  const endpoints = [
    {
      path: '/api/status',
      methods: ['GET'],
      description: 'Fetches node status, indexer status, tip height, consensus branch ID, and Zebra sync progress.',
      params: '`preset`: Preset identifier (`regtest`, `testnet`, `mainnet`).',
      response: `{
  "online": true,
  "network": "testnet",
  "height": 4542500,
  "consensusBranchId": "77190ad9",
  "upgradeName": "NU7",
  "vendor": "Zebra",
  "version": "7.0.0",
  "sync": {
    "blocks": 4542490,
    "headers": 4542500,
    "estimatedHeight": 4542500,
    "verificationProgress": 0.9999,
    "syncPercent": 99.99,
    "syncState": "synced"
  }
}`,
    },
    {
      path: '/api/account',
      methods: ['GET'],
      description: 'Returns configured account keys, addresses, birthday height, and watch-only status.',
      params: 'None (reads project `.env.local`).',
      response: `{
  "network": "regtest",
  "unifiedAddress": "uregtest1...",
  "transparentAddress": "tm...",
  "ufvk": "uviewregtest1...",
  "hasMnemonic": true,
  "isWatchOnly": false,
  "birthdayHeight": 1,
  "accountIndex": 0,
  "endpoint": "127.0.0.1:28137"
}`,
    },
    {
      path: '/api/account/import-key',
      methods: ['POST'],
      description: 'Imports a 12- or 24-word BIP-39 mnemonic or UFVK into the project configuration.',
      params: 'JSON body: `{ "mnemonic": "word1 ... word24" }` or `{ "ufvk": "uview..." }`',
      response: `{ "success": true, "address": "uregtest1..." }`,
    },
    {
      path: '/api/account/forget-key',
      methods: ['POST'],
      description: 'Clears mnemonic and UFVK from local project configuration, reverting to keyless or fixture state.',
      params: 'None.',
      response: `{ "success": true }`,
    },
    {
      path: '/api/config',
      methods: ['GET', 'POST'],
      description: 'Reads or updates project settings in `zcash.config.json` and `.env.local`.',
      params: 'GET: none. POST: `{ "network": "testnet", "endpoint": "testnet.zec.rocks:443" }`',
      response: `{ "network": "testnet", "endpoint": "testnet.zec.rocks:443" }`,
    },
    {
      path: '/api/mine',
      methods: ['POST'],
      description: 'Mines blocks on a regtest chain (Z3 or NU7).',
      params: 'JSON body: `{ "blocks": 1 }`',
      response: `{ "success": true, "mined": 1 }`,
    },
    {
      path: '/api/fund',
      methods: ['POST'],
      description: 'Funds a regtest address using the test faucet.',
      params: 'JSON body: `{ "address": "uregtest1...", "amount": "10.0" }`',
      response: `{ "success": true, "txid": "e1850e719..." }`,
    },
    {
      path: '/api/sync/status',
      methods: ['GET'],
      description: 'Returns real-time wallet scanning progress and scanned block counts.',
      params: 'None.',
      response: `{
  "status": "synced",
  "scannedBlocks": 105,
  "targetHeight": 105,
  "syncPercent": 100,
  "inProgress": false
}`,
    },
    {
      path: '/api/transactions',
      methods: ['GET'],
      description: 'Lists decrypted incoming and outgoing transactions for the configured account.',
      params: 'None.',
      response: `[
  {
    "txid": "ac7604a82...",
    "height": 102,
    "value": 100000000,
    "direction": "incoming",
    "memo": "First payment"
  }
]`,
    },
    {
      path: '/api/explorer',
      methods: ['GET'],
      description: 'Searches transactions, blocks, or addresses across the configured network node.',
      params: '`q`: Query string (txid, block hash, block height, or address). `network`: network name.',
      response: `{ "kind": "tx", "txid": "ac7604a82...", "blockHeight": 102, ... }`,
    },
  ];

  for (const ep of endpoints) {
    md += `### \`${ep.methods.join(' | ')} ${ep.path}\`\n\n`;
    md += `${ep.description}\n\n`;
    md += `**Parameters**: ${ep.params}\n\n`;
    md += `**Example Response**:\n\n`;
    md += `\`\`\`json\n${ep.response}\n\`\`\`\n\n`;
    md += `---\n\n`;
  }

  fs.writeFileSync(targetPath, md);
  console.log('✅ Generated docs/src/reference/dashboard-api.md');
}

/**
 * 6. Generate rpc.md (table of Zebra JSON-RPC, lightwalletd gRPC, and Zallet RPC calls)
 */
export async function generateRpcRef() {
  const targetPath = path.join(REF_DIR, 'rpc.md');

  let md = `<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->\n\n`;
  md += `# RPC & Protocol Reference\n\n`;
  md += `This table enumerates every RPC method (Zebra JSON-RPC, lightwalletd gRPC, and Zallet RPC) invoked across the repository, identifying the calling module, its function, and the authoritative upstream specification.\n\n`;

  md += `| Protocol | Method | Calling File / Module | Purpose | Upstream Specification |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  const rpcEntries = [
    {
      protocol: 'Zebra JSON-RPC',
      method: '`getblockchaininfo`',
      caller: '`packages/dashboard/src/app/api/status/sync.ts`, `packages/sdk/src/jsonrpc.ts`, `packages/dev/src/cli.ts`',
      purpose: 'Inspect chain tip, block count, headers, verification progress, and consensus branch ID',
      spec: '[Zcash RPC getblockchaininfo](https://zcash.github.io/rpc/getblockchaininfo.html)',
    },
    {
      protocol: 'Zebra JSON-RPC',
      method: '`getblockcount`',
      caller: '`packages/dev/src/cli.ts` (regtest setup), `packages/dashboard/src/app/api/explorer/backend.ts`',
      purpose: 'Obtain the current chain height / block count',
      spec: '[Zcash RPC getblockcount](https://zcash.github.io/rpc/getblockcount.html)',
    },
    {
      protocol: 'Zebra JSON-RPC',
      method: '`getblock`',
      caller: '`packages/dashboard/src/app/api/explorer/backend.ts`',
      purpose: 'Fetch block details by height or hash with verbosity level',
      spec: '[Zcash RPC getblock](https://zcash.github.io/rpc/getblock.html)',
    },
    {
      protocol: 'Zebra JSON-RPC',
      method: '`getrawtransaction`',
      caller: '`packages/dashboard/src/app/api/explorer/backend.ts`, `packages/core/tests/transaction_test.rs`',
      purpose: 'Fetch raw transaction hex or decoded verbose transaction data',
      spec: '[Zcash RPC getrawtransaction](https://zcash.github.io/rpc/getrawtransaction.html)',
    },
    {
      protocol: 'Zebra JSON-RPC',
      method: '`sendrawtransaction`',
      caller: '`packages/sdk/src/send.ts` (`JsonRpcVerifier`), `packages/core/tests/transaction_test.rs`',
      purpose: 'Submit serialized raw transaction hex directly to the node mempool',
      spec: '[Zcash RPC sendrawtransaction](https://zcash.github.io/rpc/sendrawtransaction.html)',
    },
    {
      protocol: 'Zebra JSON-RPC',
      method: '`getstandardfee`',
      caller: '`packages/core/tests/transaction_test.rs`',
      purpose: 'Query standard ZIP-317 fee accepted by node',
      spec: '[ZIP 317 Fee Mechanism](https://zips.z.cash/zip-0317)',
    },
    {
      protocol: 'Zebra JSON-RPC',
      method: '`generate`',
      caller: '`packages/dev/src/cli.ts`, `packages/dashboard/src/app/api/mine/route.ts`, `docker/*/regtest-init.sh`',
      purpose: 'Mine N blocks on regtest chain immediately',
      spec: '[Zebra User Documentation](https://zebra.zfnd.org/user.html)',
    },
    {
      protocol: 'Zebra JSON-RPC',
      method: '`z_gettreestate`',
      caller: '`packages/sdk/src/jsonrpc.ts`, `packages/core/tests/shard_store_test.rs`',
      purpose: 'Fetch commitment tree state and final root for Sapling, Orchard, and Ironwood',
      spec: '[Zcash RPC z_gettreestate](https://zcash.github.io/rpc/z_gettreestate.html)',
    },
    {
      protocol: 'Zallet RPC',
      method: '`listaddresses`',
      caller: '`packages/dev/src/cli.ts` (Z3 regtest setup & wipe)',
      purpose: 'Query active accounts and addresses managed by Zallet in NU6.3 regtest',
      spec: '[Zallet Repository](https://github.com/zcash/zallet)',
    },
    {
      protocol: 'Zallet RPC',
      method: '`z_getnewaccount`',
      caller: '`packages/dev/src/cli.ts` (Z3 regtest setup & wipe)',
      purpose: 'Derive a new spending account in Zallet',
      spec: '[Zallet Repository](https://github.com/zcash/zallet)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetLightdInfo`',
      caller: '`packages/sdk/src/client.ts` (`getInfo`, `verifyConsensusBranch`), `packages/dashboard/src/app/api/status/route.ts`',
      purpose: 'Retrieve indexer version, vendor, consensus branch ID, block height, and network name',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetLatestBlock`',
      caller: '`packages/sdk/src/client.ts`, `packages/dashboard/src/app/api/status/sync.ts`',
      purpose: 'Fetch compact header of the current chain tip',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetBlockRange`',
      caller: '`packages/sdk/src/client.ts` (`getBlockRange`, `getRawBlockRange`), `packages/sdk/src/sync.ts`',
      purpose: 'Stream compact blocks across height range for note detection and wallet sync',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetBlock`',
      caller: '`packages/sdk/src/client.ts` (`getBlock`), `packages/dashboard/src/app/api/explorer/backend.ts`',
      purpose: 'Fetch single compact block by height',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetTreeState`',
      caller: '`packages/sdk/src/client.ts` (`getTreeState`), `packages/sdk/src/sync.ts`',
      purpose: 'Fetch commitment tree frontier state and pool roots at height',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`SendTransaction`',
      caller: '`packages/sdk/src/client.ts` (`sendTransaction`), `packages/sdk/src/send.ts`',
      purpose: 'Broadcast serialized transaction to the network via lightwalletd',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetAddressUtxos`',
      caller: '`packages/sdk/src/client.ts` (`getAddressUtxos`), `packages/sdk/src/sync.ts`',
      purpose: 'Fetch transparent unspent transaction outputs (UTXOs)',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetTaddressTxids`',
      caller: '`packages/sdk/src/client.ts` (`getTaddressTxids`)',
      purpose: 'Retrieve list of transaction IDs affecting transparent address',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
    {
      protocol: 'lightwalletd gRPC',
      method: '`GetMempoolTx`',
      caller: '`packages/sdk/src/client.ts` (`getMempoolTx`)',
      purpose: 'Stream unconfirmed transactions from memory pool',
      spec: '[lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto)',
    },
  ];

  for (const entry of rpcEntries) {
    md += `| ${entry.protocol} | ${entry.method} | ${entry.caller} | ${entry.purpose} | ${entry.spec} |\n`;
  }

  md += `\n`;
  fs.writeFileSync(targetPath, md);
  console.log('✅ Generated docs/src/reference/rpc.md');
}

export async function runAll() {
  console.log('=== Running Documentation Generator (pnpm docs:gen) ===');
  generateKnownIssues();
  await generateScaffolderRef();
  await generateZcashDevRef();
  await generateSdkRef();
  await generateDashboardApiRef();
  await generateRpcRef();
  console.log('=== Documentation Generation Complete! ===');
}

if (process.argv[1] && (process.argv[1] === __filename || process.argv[1].endsWith('docs-gen.mjs'))) {
  runAll().catch((err) => {
    console.error('❌ docs-gen failed:', err);
    process.exit(1);
  });
}
