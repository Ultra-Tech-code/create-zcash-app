import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { runAll as runDocsGen } from './docs-gen.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_SRC = path.join(REPO_ROOT, 'docs', 'src');

/**
 * 1. Validate generated files have not drifted from git
 */
export async function checkGeneratedDrift() {
  console.log('--- Step 1: Checking Generated Reference Docs Drift ---');
  await runDocsGen();

  try {
    execSync('git diff --exit-code docs/src/reference docs/src/known-issues.md', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    console.log('✅ Generated reference files & known-issues.md match committed repository state.');
  } catch (err) {
    console.error(
      '\n❌ Documentation drift detected: generated reference files or known-issues.md differ from committed files.\n' +
      'Run "pnpm docs:gen" to update them and commit the resulting changes.\n'
    );
    process.exit(1);
  }
}

/**
 * Helper to extract option flags from a Commander Command object
 */
function getCommandFlags(cmd) {
  const flags = new Set();
  for (const opt of cmd.options || []) {
    // opt.flags can be e.g. "-e, --endpoint <endpoint>" or "--stack <stack>" or "-y, --yes"
    const parts = opt.flags.split(/[\s,]+/);
    for (const p of parts) {
      if (p.startsWith('--')) {
        flags.add(p.replace(/<.*>|\[.*\]/, '').trim());
      } else if (p.startsWith('-')) {
        flags.add(p.trim());
      }
    }
  }
  return flags;
}

/**
 * 2. Validate CLI commands and flags mentioned in code blocks of prose chapters
 */
export async function checkProseCommands() {
  console.log('--- Step 2: Validating CLI Commands & Flags in Prose Chapters ---');

  const cliDistPath = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
  const devDistPath = path.join(REPO_ROOT, 'packages', 'dev', 'dist', 'cli.js');

  const { program: scaffolderProgram } = await import(cliDistPath);
  const { program: devProgram } = await import(devDistPath);

  const scaffolderFlags = getCommandFlags(scaffolderProgram);

  // Map of dev subcommands and options
  const devCommandsMap = new Map();
  for (const cmd of devProgram.commands) {
    const cmdName = cmd.name();
    const subcmds = cmd.commands || [];
    if (subcmds.length > 0) {
      for (const sub of subcmds) {
        const fullSub = `${cmdName} ${sub.name()}`;
        const alias = sub.alias();
        const flags = getCommandFlags(sub);
        devCommandsMap.set(fullSub, flags);
        if (alias) {
          devCommandsMap.set(`${cmdName} ${alias}`, flags);
        }
      }
    } else {
      const flags = getCommandFlags(cmd);
      devCommandsMap.set(cmdName, flags);
      const alias = cmd.alias();
      if (alias) {
        devCommandsMap.set(alias, flags);
      }
    }
  }

  // Find all prose markdown files in docs/src (excluding reference/)
  const proseFiles = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== 'reference') walk(full);
      } else if (ent.name.endsWith('.md')) {
        proseFiles.push(full);
      }
    }
  }
  walk(DOCS_SRC);

  let errors = 0;

  for (const filePath of proseFiles) {
    const relPath = path.relative(REPO_ROOT, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    let inCodeBlock = false;
    let isShellBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim().toLowerCase();
        if (!inCodeBlock) {
          inCodeBlock = true;
          isShellBlock = ['bash', 'sh', 'zsh', 'shell', 'text', ''].includes(lang);
        } else {
          inCodeBlock = false;
          isShellBlock = false;
        }
        continue;
      }

      if (!inCodeBlock || !isShellBlock) continue;
      if (line.startsWith('#') || line.startsWith('//') || !line) continue;

      // Check create-zcash-app invocations
      if (line.includes('create-zcash-app')) {
        const tokens = line.split(/\s+/);
        for (const token of tokens) {
          if (token.startsWith('--') && !token.startsWith('---')) {
            const flagName = token.split('=')[0];
            if (!scaffolderFlags.has(flagName)) {
              console.error(`❌ ${relPath}:${i + 1}: Unknown create-zcash-app flag "${flagName}" in command: "${line}"`);
              errors++;
            }
          }
        }
      }

      // Check zcash-dev invocations
      if (line.includes('zcash-dev')) {
        const afterCmd = line.slice(line.indexOf('zcash-dev') + 'zcash-dev'.length).trim();
        const tokens = afterCmd.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;

        let matchedCmd = null;
        let tokenIndex = 0;

        // Try two-token command (e.g. "regtest up", "testnet lightwalletd")
        if (tokens.length >= 2) {
          const twoToken = `${tokens[0]} ${tokens[1]}`;
          if (devCommandsMap.has(twoToken)) {
            matchedCmd = twoToken;
            tokenIndex = 2;
          }
        }

        // Try single-token command (e.g. "address", "balance", "mine", "fund", "send")
        if (!matchedCmd && devCommandsMap.has(tokens[0])) {
          matchedCmd = tokens[0];
          tokenIndex = 1;
        }

        if (!matchedCmd) {
          console.error(`❌ ${relPath}:${i + 1}: Unknown zcash-dev command in: "${line}"`);
          errors++;
          continue;
        }

        const validFlags = devCommandsMap.get(matchedCmd);

        for (let j = tokenIndex; j < tokens.length; j++) {
          const t = tokens[j];
          if (t.startsWith('--') && !t.startsWith('---')) {
            const flag = t.split('=')[0];
            if (!validFlags.has(flag)) {
              console.error(`❌ ${relPath}:${i + 1}: Unknown flag "${flag}" for zcash-dev command "${matchedCmd}" in: "${line}"`);
              errors++;
            }
          } else if (t.startsWith('-') && t.length === 2) {
            if (!validFlags.has(t)) {
              console.error(`❌ ${relPath}:${i + 1}: Unknown short flag "${t}" for zcash-dev command "${matchedCmd}" in: "${line}"`);
              errors++;
            }
          }
        }
      }
    }
  }

  if (errors > 0) {
    console.error(`\n❌ Found ${errors} invalid CLI commands or flags in documentation prose.\n`);
    process.exit(1);
  }

  console.log(`✅ All CLI commands and flags across ${proseFiles.length} prose files match the command trees.`);
}

/**
 * 3. Validate internal links and anchors
 */
export function checkInternalLinks() {
  console.log('--- Step 3: Validating Internal Markdown Links & Anchors ---');

  const allMarkdownFiles = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.name.endsWith('.md')) {
        allMarkdownFiles.push(full);
      }
    }
  }
  walk(DOCS_SRC);

  let linkErrors = 0;

  for (const filePath of allMarkdownFiles) {
    const relPath = path.relative(REPO_ROOT, filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    // Extract links: [text](target)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const rawTarget = match[2].trim();

      // Skip external links or code links
      if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://') || rawTarget.startsWith('mailto:') || rawTarget.startsWith('file://')) {
        continue;
      }

      const [targetFilePart, anchorPart] = rawTarget.split('#');

      let resolvedFile = filePath;
      if (targetFilePart) {
        resolvedFile = path.resolve(path.dirname(filePath), targetFilePart);
      }

      if (!fs.existsSync(resolvedFile)) {
        console.error(`❌ ${relPath}: Broken internal link to missing file "${rawTarget}"`);
        linkErrors++;
        continue;
      }

      if (anchorPart) {
        const targetContent = fs.readFileSync(resolvedFile, 'utf8');
        // Match headings or HTML anchors
        const headingRegex = /^#+\s+(.+)$/gm;
        let foundAnchor = false;
        let hMatch;

        const slugify = (s) =>
          s
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-');

        const normalizedAnchor = anchorPart.toLowerCase();

        while ((hMatch = headingRegex.exec(targetContent)) !== null) {
          const headingSlug = slugify(hMatch[1]);
          if (headingSlug === normalizedAnchor || headingSlug.includes(normalizedAnchor) || normalizedAnchor.includes(headingSlug)) {
            foundAnchor = true;
            break;
          }
        }

        if (!foundAnchor && targetContent.includes(`id="${anchorPart}"`)) {
          foundAnchor = true;
        }

        if (!foundAnchor) {
          console.error(`❌ ${relPath}: Missing anchor "#${anchorPart}" in "${path.relative(REPO_ROOT, resolvedFile)}"`);
          linkErrors++;
        }
      }
    }
  }

  if (linkErrors > 0) {
    console.error(`\n❌ Found ${linkErrors} broken internal links or anchors in docs.\n`);
    process.exit(1);
  }

  console.log(`✅ All internal links and anchor references are valid across ${allMarkdownFiles.length} docs files.`);
}

/**
 * 4. Validate external web links
 */
export async function checkExternalLinks() {
  console.log('--- Step 4: Validating External Web Links ---');

  // If mdbook-linkcheck2 is available, run it
  try {
    execSync('mdbook-linkcheck2 -s docs', { cwd: REPO_ROOT, stdio: 'inherit' });
    console.log('✅ mdbook-linkcheck2 validated all internal and external web links cleanly.');
    return;
  } catch (err) {
    if (err.status !== 127 && err.code !== 'ENOENT') {
      console.error('❌ mdbook-linkcheck2 found broken links.');
      process.exit(1);
    }
  }

  // Fallback: extract all http(s) URLs and check with fetch
  const allMarkdownFiles = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.md')) allMarkdownFiles.push(full);
    }
  }
  walk(DOCS_SRC);

  const urlRegex = /https?:\/\/[^\s)\]>"']+/g;
  const urlsToCheck = new Set();

  for (const f of allMarkdownFiles) {
    const content = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = urlRegex.exec(content)) !== null) {
      let u = m[0].replace(/[.,;:!?]+$/, '');
      if (u.includes('localhost') || u.includes('127.0.0.1')) continue;
      urlsToCheck.add(u);
    }
  }

  let failed = 0;
  for (const u of urlsToCheck) {
    try {
      const res = await fetch(u, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status >= 400 && res.status !== 403 && res.status !== 405) {
        const getRes = await fetch(u, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (getRes.status >= 400 && getRes.status !== 403) {
          console.error(`❌ HTTP ${getRes.status} for URL: ${u}`);
          failed++;
        }
      }
    } catch (e) {
      console.error(`❌ Failed to connect to URL: ${u} (${e.message})`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n❌ Found ${failed} unreachable external URLs.\n`);
    process.exit(1);
  }

  console.log(`✅ All ${urlsToCheck.size} external URLs verified.`);
}

export async function main() {
  console.log('=== Running Documentation Check (pnpm docs:check) ===');
  await checkGeneratedDrift();
  await checkProseCommands();
  checkInternalLinks();
  if (process.argv.includes('--external')) {
    await checkExternalLinks();
  } else {
    console.log('--- Step 4: External Web Link Check Skipped (offline default; pass --external to run) ---');
  }
  console.log('=== All Documentation Checks Passed Cleanly! ===\n');
}

if (process.argv[1] && (process.argv[1] === __filename || process.argv[1].endsWith('docs-check.mjs'))) {
  main().catch((err) => {
    console.error('❌ docs:check failed:', err);
    process.exit(1);
  });
}
