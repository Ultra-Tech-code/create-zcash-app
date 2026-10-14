#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';

const program = new Command();

program
  .name('create-zcash-app')
  .description('Scaffold a shielded Zcash application powered by Z3 and @zcash-app/sdk')
  .argument('[project-name]', 'Name of the project directory')
  .option('-t, --template <template>', 'Template to use (nextjs-fullstack | express-api | scanner)', 'nextjs-fullstack')
  .option('-n, --network <network>', 'Network (regtest | testnet | mainnet)', 'regtest')
  .action(async (projectNameArg, options) => {
    let projectName = projectNameArg;

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

    console.log(`\n🚀 Scaffolding shielded Zcash app in ${targetDir}...`);
    fs.mkdirSync(targetDir, { recursive: true });

    // 1. Create scaffolded package.json
    const packageJson = {
      name: projectName,
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        mine: 'zcash-dev mine',
        fund: 'zcash-dev fund',
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
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    // 2. Write .env.regtest config
    const envContent = `# create-zcash-app environment config
ZCASH_NETWORK=${options.network}
ZCASH_ENDPOINT=127.0.0.1:8137
# Z3 Stack Pin Override: Zaino >= 0.10.0 required for Ironwood support
Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0
`;
    fs.writeFileSync(path.join(targetDir, '.env.local'), envContent);

    // 3. Write README.md with workshop lab instructions
    const readmeContent = `# ${projectName}

Built with [create-zcash-app](https://github.com/zcash/create-zcash-app) on the **Z3 stack** (Zebra + Zaino + Zallet).

## Getting Started

1. **Start the local Z3 regtest stack**:
   \`\`\`bash
   docker compose up -d
   \`\`\`

2. **Run your development server**:
   \`\`\`bash
   npm run dev
   # or pnpm dev
   \`\`\`

3. **Fund your address locally**:
   \`\`\`bash
   npx zcash-dev fund <YOUR_UNIFIED_ADDRESS> 1.0
   \`\`\`

4. **Watch your deposit land**:
   The app automatically scans both Orchard and the quantum-recoverable Ironwood pool!
`;
    fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);

    console.log(`\n🎉 Success! Created ${projectName} at ${targetDir}`);
    console.log(`\nInside that directory, you can run:`);
    console.log(`  cd ${projectName}`);
    console.log(`  npm install`);
    console.log(`  npm run dev\n`);
  });

program.parse(process.argv);
