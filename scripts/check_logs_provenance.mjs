#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const logsDir = path.join(projectRoot, 'packages', 'core', 'tests', 'logs');
const manifestPath = path.join(logsDir, 'MANIFEST');

if (!fs.existsSync(manifestPath)) {
  console.error(`❌ ERROR: Log provenance MANIFEST not found at ${manifestPath}`);
  process.exit(1);
}

console.log('=== Checking Log Provenance & Integrity against MANIFEST ===');

const manifestLines = fs.readFileSync(manifestPath, 'utf8').split('\n');
const manifestEntries = new Map();

for (const line of manifestLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;

  // Format: <sha256>  <relpath>  |  <command>
  const match = trimmed.match(/^([a-f0-9]{64})\s+(\S+)\s+\|\s+(.*)$/);
  if (!match) {
    console.error(`❌ Malformed MANIFEST line: ${line}`);
    process.exit(1);
  }

  const [, expectedHash, relPath, command] = match;
  manifestEntries.set(relPath, {
    hash: expectedHash.toLowerCase(),
    command: command.trim()
  });
}

function getAllFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    if (item === 'MANIFEST' || item === '.DS_Store') continue;
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

const diskFiles = getAllFiles(logsDir);
let errors = 0;
let checked = 0;

for (const fullPath of diskFiles) {
  const relPath = path.relative(logsDir, fullPath);
  if (!manifestEntries.has(relPath)) {
    console.error(`❌ UNLISTED FILE: ${relPath} is on disk but not listed in MANIFEST!`);
    errors++;
    continue;
  }

  const entry = manifestEntries.get(relPath);
  const fileBytes = fs.readFileSync(fullPath);
  const actualHash = crypto.createHash('sha256').update(fileBytes).digest('hex').toLowerCase();

  if (actualHash !== entry.hash) {
    console.error(`❌ HASH MISMATCH for ${relPath}:`);
    console.error(`   Expected: ${entry.hash}`);
    console.error(`   Actual:   ${actualHash}`);
    errors++;
  }

  if (!entry.command) {
    console.error(`❌ EMPTY COMMAND for ${relPath} in MANIFEST!`);
    errors++;
  }

  checked++;
}

for (const [relPath] of manifestEntries.entries()) {
  const fullPath = path.join(logsDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ MISSING FILE: ${relPath} listed in MANIFEST but not found on disk!`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n❌ Provenance check FAILED with ${errors} error(s).`);
  process.exit(1);
}

console.log(`✅ All ${checked} log files match MANIFEST sha256 and recorded provenance commands cleanly.`);
