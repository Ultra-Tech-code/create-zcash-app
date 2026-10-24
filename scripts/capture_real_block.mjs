import * as grpc from '../packages/sdk/node_modules/@grpc/grpc-js/build/src/index.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const targetHeight = process.argv[2] ? parseInt(process.argv[2], 10) : 2;
  const endpoint = process.env.ZCASH_ENDPOINT || '127.0.0.1:28137';

  console.log(`=== CAPTURING RAW gRPC BYTES FROM ZAINO (${endpoint}) FOR BLOCK ${targetHeight} ===\n`);

  // Define low-level gRPC method on CompactTxStreamer/GetBlockRange
  // with responseDeserialize = (buffer) => buffer to bypass protobufjs completely
  const client = new grpc.Client(endpoint, grpc.credentials.createInsecure());

  // Encode BlockRange proto: start.height = targetHeight, end.height = targetHeight
  const encodeVarint = (num) => {
    const res = [];
    while (num >= 0x80) {
      res.push((num & 0x7f) | 0x80);
      num >>>= 7;
    }
    res.push(num);
    return res;
  };

  const heightVarint = encodeVarint(targetHeight);
  const blockIdPayload = [0x08, ...heightVarint];
  const reqBytes = Buffer.from([
    0x0a, blockIdPayload.length, ...blockIdPayload, // field 1: start
    0x12, blockIdPayload.length, ...blockIdPayload, // field 2: end
  ]);

  const rawChunks = [];
  await new Promise((resolve, reject) => {
    const call = client.makeServerStreamRequest(
      '/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlockRange',
      (arg) => arg,
      (buf) => buf, // Identity deserialize: raw bytes directly from HTTP/2 payload
      reqBytes
    );

    call.on('data', (rawBuffer) => {
      rawChunks.push(rawBuffer);
    });

    call.on('error', (err) => {
      reject(err);
    });

    call.on('end', () => {
      resolve();
    });
  });

  client.close();

  if (rawChunks.length === 0) {
    console.error(`Error: No blocks returned from Zaino for height ${targetHeight}`);
    process.exit(1);
  }

  const rawBlock = rawChunks[0];
  const sha256 = crypto.createHash('sha256').update(rawBlock).digest('hex');

  console.log(`Block Height: ${targetHeight}`);
  console.log(`Raw Size:     ${rawBlock.length} bytes`);
  console.log(`SHA256:       ${sha256}`);
  console.log('\nHexdump of first 64 bytes:');
  for (let i = 0; i < Math.min(rawBlock.length, 64); i += 16) {
    const slice = rawBlock.subarray(i, i + 16);
    const hexPart = slice.toString('hex').match(/.{1,2}/g).join(' ');
    const asciiPart = Array.from(slice)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
      .join('');
    console.log(`  ${i.toString(16).padStart(4, '0')}:  ${hexPart.padEnd(48, ' ')}  |${asciiPart}|`);
  }

  const fixtureDir = path.resolve(__dirname, '../packages/core/tests/fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const outFileName = process.argv[3] || 'real_regtest_block.bin';
  const outPath = path.join(fixtureDir, outFileName);
  fs.writeFileSync(outPath, rawBlock);
  console.log(`\n✅ Saved raw bytes to: ${outPath}\n`);
}

main().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
