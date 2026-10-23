import { createClient } from '../dist/index.js';

async function main() {
  const client = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
  const height = 219;
  const stream = client.getBlockRange(height, height);

  for await (const block of stream) {
    console.log('=== COMPACT BLOCK FROM ZAINO (gRPC 127.0.0.1:28137) ===');
    const blockData = {
      height: block.height,
      hash: Buffer.from(block.hash).reverse().toString('hex'),
      prevHash: Buffer.from(block.prevHash).reverse().toString('hex'),
      time: block.time,
      vtxCount: block.vtx?.length,
      vtx: block.vtx?.map((tx) => {
        const rawTxid = tx.txid || tx.hash;
        const txidHex = rawTxid ? Buffer.from(rawTxid).reverse().toString('hex') : 'unknown';
        return {
          index: tx.index,
          txid: txidHex,
          fee: tx.fee,
          spendsCount: tx.spends?.length || 0,
          outputsCount: tx.outputs?.length || 0,
          orchardActionsCount: tx.actions?.length || 0,
          ironwoodActionsCount: tx.ironwoodActions?.length || 0,
          ironwoodActions: tx.ironwoodActions?.map((act, i) => ({
            actionIndex: i,
            nullifier: Buffer.from(act.nullifier).toString('hex'),
            cmx: Buffer.from(act.cmx).toString('hex'),
            ephemeralKey: Buffer.from(act.ephemeralKey).toString('hex'),
            ciphertextLen: (act.ciphertext || act.cipherText)?.length,
          })),
        };
      }),
    };
    console.log(JSON.stringify(blockData, null, 2));
  }

  await client.close();
}

main().catch(console.error);
