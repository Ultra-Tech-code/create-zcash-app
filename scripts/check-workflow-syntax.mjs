#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targetWorkflows = process.argv.slice(2);
const workflowFiles = targetWorkflows.length > 0
  ? targetWorkflows
  : [
      path.join(repoRoot, '.github/workflows/release.yml'),
      path.join(repoRoot, '.github/workflows/ci.yml'),
    ];

let totalChecks = 0;
let failures = 0;

for (const workflowPath of workflowFiles) {
  const relPath = path.relative(repoRoot, workflowPath);
  console.log(`Checking workflow syntax in ${relPath}...`);

  if (!fs.existsSync(workflowPath)) {
    console.error(`ERROR: Workflow file not found: ${relPath}`);
    failures++;
    continue;
  }

  const rawYaml = fs.readFileSync(workflowPath, 'utf8');
  let doc;
  try {
    doc = load(rawYaml);
  } catch (err) {
    console.error(`ERROR: YAML parse failure in ${relPath}: ${err.message}`);
    failures++;
    continue;
  }

  for (const [jobId, job] of Object.entries(doc.jobs || {})) {
    const steps = (job && Array.isArray(job.steps)) ? job.steps : [];
    for (const [stepIdx, step] of steps.entries()) {
      if (!step || typeof step.run !== 'string') continue;
      const stepName = step.name || `job:${jobId} step:${stepIdx + 1}`;

      // 1. Check bash block syntax with bash -n
      totalChecks++;
      try {
        execSync('bash -n', {
          input: step.run,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf8',
        });
        console.log(`  [bash -n] OK: ${stepName}`);
      } catch (err) {
        console.error(`  [bash -n] FAILED: ${stepName}\n${err.stderr || err.message}`);
        failures++;
      }

      // 2. Extract and check node heredocs: node ... <<'TAG' ... TAG
      // Matches both <<'NODE' and <<NODE
      const heredocRegex = /node\s+.*?<<\s*['"]?([A-Za-z0-9_]+)['"]?\s*\n([\s\S]*?)\n\s*\1/g;
      let match;
      while ((match = heredocRegex.exec(step.run)) !== null) {
        const tag = match[1];
        const jsCode = match[2];
        totalChecks++;
        try {
          execSync('node --check', {
            input: jsCode,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf8',
          });
          console.log(`  [node --check <<${tag}] OK: ${stepName}`);
        } catch (err) {
          console.error(`  [node --check <<${tag}] FAILED: ${stepName}\n${err.stderr || err.message}`);
          failures++;
        }
      }

      // 3. Extract and check inline node -e '...' scripts
      const nodeEvalRegex = /node\s+(?:-[^\s]+\s+)*-e\s+'([\s\S]*?)'/g;
      while ((match = nodeEvalRegex.exec(step.run)) !== null) {
        const jsCode = match[1];
        totalChecks++;
        try {
          execSync('node --check', {
            input: jsCode,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf8',
          });
          console.log(`  [node --check -e] OK: ${stepName}`);
        } catch (err) {
          console.error(`  [node --check -e] FAILED: ${stepName}\n${err.stderr || err.message}`);
          failures++;
        }
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nFAILED: Found ${failures} syntax error(s) across ${totalChecks} check(s).`);
  process.exit(1);
} else {
  console.log(`\nSUCCESS: All ${totalChecks} syntax check(s) passed cleanly.`);
  process.exit(0);
}
