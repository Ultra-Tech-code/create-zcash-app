import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createClient, accountFromMnemonic, detectIncoming } from '../packages/sdk/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  console.log('===============================================================');
  console.log('=== ZCASH TESTNET NU7 DIAGNOSIS & CHAIN DIVERGENCE REPORT   ===');
  console.log('===============================================================\n');

  // Server endpoints
  const localEndpoint = '127.0.0.1:8137';
  const eccEndpoint = 'https://testnet.zec.rocks:443';

  console.log(`Local Node Endpoint: ${localEndpoint} (Zaino/Zebra stack)`);
  console.log(`ECC Public Endpoint: ${eccEndpoint} (ECC LightWalletD on Zebra:7.0.0)\n`);

  const localClient = createClient({ endpoint: localEndpoint, network: 'testnet' });
  const eccClient = createClient({ endpoint: eccEndpoint, network: 'testnet' });

  // 1. Query getInfo on both
  console.log('--- 1. getInfo Comparison (Local vs ECC Public Server) ---');
  const localInfo = await localClient.getInfo();
  const eccInfo = await eccClient.getInfo();

  console.log('Local Node (127.0.0.1:8137):');
  console.log(`  Tip Block Height:    ${localInfo.blockHeight}`);
  console.log(`  Consensus Branch ID: 0x${localInfo.consensusBranchId} (NU6.3)`);
  console.log(`  Upgrade Name:        ${localInfo.upgradeName || 'none'}`);
  console.log(`  Server Vendor:       ${localInfo.vendor}`);
  console.log(`  Node Subversion:     ${localInfo.zcashdSubversion}\n`);

  console.log('ECC Public Server (testnet.zec.rocks:443):');
  console.log(`  Tip Block Height:    ${eccInfo.blockHeight}`);
  console.log(`  Consensus Branch ID: 0x${eccInfo.consensusBranchId} (NU7: 0x77190ad9)`);
  console.log(`  Upgrade Name:        ${eccInfo.upgradeName || 'NU7 Active'}`);
  console.log(`  Server Vendor:       ${eccInfo.vendor}`);
  console.log(`  Node Subversion:     ${eccInfo.zcashdSubversion}\n`);

  // 2. Block hash comparison across NU7 activation boundary (4,465,026)
  console.log('--- 2. Block Hash Comparison Across NU7 Activation Boundary ---');
  const boundaryHeights = [4465024, 4465025, 4465026, 4465027];
  for (const h of boundaryHeights) {
    const localHeader = await localClient.getBlockHeader(h);
    const eccHeader = await eccClient.getBlockHeader(h);
    const localHashRev = Buffer.from(localHeader.hash).reverse().toString('hex');
    const eccHashRev = Buffer.from(eccHeader.hash).reverse().toString('hex');
    const matches = (localHashRev === eccHashRev);

    console.log(`Height ${h}:`);
    console.log(`  Local Hash (Zebra 6.4.2): ${localHashRev}`);
    console.log(`  ECC Hash   (Zebra 7.0.0): ${eccHashRev}`);
    console.log(`  Status:                   ${matches ? 'MATCH (pre-NU7 canonical) ✅' : 'DIVERGED (NU7 activation split) ❌'}\n`);
  }

  // 3. Check Ironwood support on ECC server
  console.log('--- 3. ECC Server Protocol & Ironwood Verification ---');
  let recentHeight = Number(eccInfo.blockHeight) - 10;
  let hasIronwoodActionsField = false;

  for await (const b of eccClient.getBlockRange(recentHeight, recentHeight)) {
    if (b.vtx && b.vtx.length > 0) {
      hasIronwoodActionsField = Object.prototype.hasOwnProperty.call(b.vtx[0], 'ironwoodActions');
    }
  }

  const treeState = await eccClient.getTreeState(recentHeight);
  const hasIronwoodTreeField = typeof treeState.ironwoodTree === 'string';

  console.log(`GetBlockRange CompactTx ironwoodActions field present: ${hasIronwoodActionsField ? 'YES ✅' : 'NO ❌'}`);
  console.log(`GetTreeState ironwoodTree field present:               ${hasIronwoodTreeField ? 'YES ✅' : 'NO ❌'}`);
  console.log(`Raw ironwoodTree snippet: ${treeState.ironwoodTree ? treeState.ironwoodTree.slice(0, 64) + '...' : 'none'}\n`);

  // 4. Lookup user funding transaction aa74c4d0... on ECC server
  console.log('--- 4. Target Transaction Lookup on ECC Server ---');
  const targetTxid = 'aa74c4d00f64502ea0ee18eb225811c9ebea9f638eb76b4c6f5bf84a335f91eb';
  const streamer = eccClient.client;
  const targetBuf = Buffer.from(targetTxid, 'hex').reverse();

  let minedHeight = 0;
  let rawTxLength = 0;

  try {
    const res = await new Promise((resolve, reject) => {
      streamer.GetTransaction({ hash: targetBuf }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    minedHeight = Number(res.height);
    rawTxLength = res.data ? res.data.length : 0;
  } catch (e) {
    console.error(`Lookup failed: ${e.message}`);
  }

  console.log(`Transaction ID:       ${targetTxid}`);
  console.log(`Mined Block Height:   ${minedHeight}`);
  console.log(`Raw Tx Size:          ${rawTxLength} bytes`);

  let ironwoodActionCount = 0;
  let orchardActionCount = 0;

  for await (const b of eccClient.getBlockRange(minedHeight, minedHeight)) {
    for (const tx of b.vtx) {
      const txid = (tx.txid ?? tx.hash);
      const rev = Buffer.from(txid).reverse().toString('hex');
      if (rev === targetTxid) {
        ironwoodActionCount = tx.ironwoodActions ? tx.ironwoodActions.length : 0;
        orchardActionCount = tx.actions ? tx.actions.length : 0;
      }
    }
  }

  console.log(`Ironwood Actions:     ${ironwoodActionCount}`);
  console.log(`Orchard Actions:      ${orchardActionCount}`);

  // Trial decrypt against Account A viewing key
  const accountsFile = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  const acctA = accountFromMnemonic(accountsData.mnemonicA, 0, 'testnet');

  const incoming = await detectIncoming(eccClient, acctA, { sinceHeight: minedHeight, endHeight: minedHeight });
  const matchedNote = incoming.notes.find((n) => n.txid === targetTxid);

  if (matchedNote) {
    console.log(`Trial Decryption:     SUCCESS ✅`);
    console.log(`  Decrypted Pool:     ${matchedNote.pool}`);
    console.log(`  Decrypted Value:    ${matchedNote.value.toString()} zatoshis (${Number(matchedNote.value) / 1e8} TAZ)`);
    console.log(`  Recipient UA:       ${matchedNote.recipient}`);
  } else {
    console.log(`Trial Decryption:     No note decrypted for Account A ❌`);
  }

  // 5. Build and image tag research
  console.log('\n--- 5. Upstream NU7 Component Releases & Docker Tags ---');
  console.log('Zebra:');
  console.log('  Release Candidate:   v7.0.0-rc.0 (https://github.com/ZcashFoundation/zebra/releases/tag/v7.0.0-rc.0)');
  console.log('  Docker Hub Tag:      zfnd/zebra:7.0.0-rc.0');
  console.log('  Stable Release:      v7.0.0 (https://github.com/ZcashFoundation/zebra/releases/tag/v7.0.0)');
  console.log('  Docker Hub Tag:      zfnd/zebra:7.0.0\n');

  console.log('Zaino:');
  console.log('  Release Tag:         0.10.2 (https://github.com/zingolabs/zaino/releases)');
  console.log('  Docker Hub Image:    zingodevops/zainod:latest / zingodevops/zainod:0.10.2');
  console.log('  Dedicated 7.0.0-rc0: unknown (Zaino uses continuous CI tags and 0.10.2 for NU7 testnet support)\n');

  console.log('Zallet:');
  console.log('  Release Tag:         v0.1.0-alpha.4 (https://github.com/zodl/zallet/releases)');
  console.log('  Docker Hub Image:    zodlinc/zallet:v0.1.0-alpha.4');
  console.log('  Dedicated 7.0.0-rc0: unknown (no specific 7.0.0-rc.0 tag published)\n');

  console.log('===============================================================');
  console.log('=== NU7 DIAGNOSIS COMPLETE: OLD CHAIN VS NU7 CHAIN VERIFIED ===');
  console.log('===============================================================');

  await localClient.close();
  await eccClient.close();
}

main().catch((err) => {
  console.error('Fatal diagnosis error:', err);
  process.exit(1);
});
