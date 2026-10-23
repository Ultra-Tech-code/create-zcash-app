// Dump Ironwood commitments ONLY from compact blocks (NU6.3 activation height 2 on regtest)
// Strictly NO fallback to Orchard actions (tx.actions). Fails loudly if tx.ironwoodActions is missing.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '../dist/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const client = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
  const info = await client.getInfo();
  const currentHeight = parseInt(info.blockHeight, 10);
  console.log(`Current block height: ${currentHeight}`);

  const startHeight = 2; // Regtest NU6.3 pool activation height
  console.log(`Scanning Ironwood commitments strictly from activation height ${startHeight}...`);

  const cmxs = [];
  let totalBlocks = 0;
  let totalIronwoodActions = 0;

  for await (const block of client.getBlockRange(startHeight, currentHeight)) {
    totalBlocks++;
    const bHeight = Number(block.height);
    if (!block.vtx) continue;

    for (const tx of block.vtx) {
      // STRICT CHECK: Never fall back to tx.actions. Only tx.ironwoodActions is valid for Ironwood pool.
      const ironwoodActions = tx.ironwoodActions;
      if (!ironwoodActions || ironwoodActions.length === 0) {
        continue;
      }

      for (const act of ironwoodActions) {
        totalIronwoodActions++;
        if (!act.cmx || act.cmx.length !== 32) {
          throw new Error(`Invalid or missing cmx in ironwoodAction in tx ${tx.hash ? Buffer.from(tx.hash).toString('hex') : 'unknown'} at block ${bHeight}`);
        }
        cmxs.push({
          height: bHeight,
          cmx: Buffer.from(act.cmx).toString('hex'),
        });
      }
    }
  }

  const outDir = path.resolve(__dirname, '../../core/tests/fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'test_cmxs.json');

  const payload = {
    startHeight,
    height: currentHeight,
    totalBlocks,
    totalIronwoodActions,
    cmxs,
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`Successfully extracted ${cmxs.length} Ironwood commitments.`);
  console.log(`Saved strictly to ${outFile} (No Orchard fallback allowed).`);
  client.close();
}

main().catch((err) => {
  console.error('Fatal error dumping Ironwood commitments:', err);
  process.exit(1);
});
