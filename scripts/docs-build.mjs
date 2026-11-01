import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAll as runDocsGen } from './docs-gen.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  console.log('=== Building Documentation Book (pnpm docs:build) ===');
  await runDocsGen();

  console.log('--- Running mdbook build docs ---');
  try {
    execSync('mdbook build docs', { cwd: REPO_ROOT, stdio: 'inherit' });
    console.log('🎉 mdBook build completed successfully!');
  } catch (err) {
    console.error('❌ mdbook build failed:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

