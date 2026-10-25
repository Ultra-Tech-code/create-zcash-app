import path from 'path';
import { fileURLToPath } from 'url';
import * as grpc from '../packages/sdk/node_modules/@grpc/grpc-js/build/src/index.js';
import * as protoLoader from '../packages/sdk/node_modules/@grpc/proto-loader/build/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const protoPath = path.resolve(__dirname, '../packages/sdk/proto/service.proto');

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.resolve(__dirname, '../packages/sdk/proto')],
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const CompactTxStreamer = protoDescriptor.cash.z.wallet.sdk.rpc.CompactTxStreamer;

const candidateEndpoints = [
  { raw: 'https://testnet.zec.rocks:443', host: 'testnet.zec.rocks:443', tls: true },
  { raw: 'https://zaino.testnet.unsafe.zec.rocks:443', host: 'zaino.testnet.unsafe.zec.rocks:443', tls: true },
  { raw: 'testnet.lightwalletd.com:9067', host: 'testnet.lightwalletd.com:9067', tls: false },
  { raw: 'https://testnet.lightwalletd.com:443', host: 'testnet.lightwalletd.com:443', tls: true },
  { raw: 'lightwalletd.testnet.electriccoin.co:9067', host: 'lightwalletd.testnet.electriccoin.co:9067', tls: false },
  { raw: 'https://lightwalletd.testnet.electriccoin.co:443', host: 'lightwalletd.testnet.electriccoin.co:443', tls: true },
  { raw: 'https://na.testnet.zec.rocks:443', host: 'na.testnet.zec.rocks:443', tls: true },
  { raw: 'https://eu.testnet.zec.rocks:443', host: 'eu.testnet.zec.rocks:443', tls: true },
  { raw: 'lwd.testnet.zcashexplorer.app:9067', host: 'lwd.testnet.zcashexplorer.app:9067', tls: false },
  { raw: 'https://lwd.testnet.zcashexplorer.app:443', host: 'lwd.testnet.zcashexplorer.app:443', tls: true },
];

async function probeEndpoint(ep) {
  const label = `[${ep.raw}] (third-party server)`;
  console.log(`${label} Probing endpoint: host=${ep.host}, TLS=${ep.tls ? 'yes' : 'no'}...`);

  const creds = ep.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
  const client = new CompactTxStreamer(ep.host, creds);

  const timeoutMs = 7000;
  const deadline = new Date(Date.now() + timeoutMs);

  return new Promise((resolve) => {
    client.GetLightdInfo({}, { deadline }, (err, response) => {
      if (err) {
        console.log(`${label} Connection failed: ${err.message} (code: ${err.code})`);
        client.close();
        resolve({
          endpoint: ep.raw,
          tls: ep.tls,
          status: 'FAILED',
          error: err.message,
        });
      } else {
        console.log(`${label} GetLightdInfo SUCCESS:`);
        console.log(`${label}   Consensus Branch ID: 0x${response.consensusBranchId}`);
        console.log(`${label}   Upgrade Name:        ${response.upgradeName || 'none'}`);
        console.log(`${label}   Tip Block Height:    ${response.blockHeight}`);
        console.log(`${label}   Chain Name:          ${response.chainName}`);
        console.log(`${label}   Vendor:              ${response.vendor}`);
        console.log(`${label}   Server Version:      ${response.version}`);
        console.log(`${label}   Node Subversion:     ${response.zcashdSubversion || 'none'}`);
        client.close();
        resolve({
          endpoint: ep.raw,
          tls: ep.tls,
          status: 'SUCCESS',
          consensusBranchId: response.consensusBranchId,
          upgradeName: response.upgradeName || 'none',
          blockHeight: response.blockHeight,
          chainName: response.chainName,
          vendor: response.vendor,
          version: response.version,
          zcashdSubversion: response.zcashdSubversion || 'none',
        });
      }
    });
  });
}

async function main() {
  console.log('=== CANDIDATE TESTNET ENDPOINTS SURVEY ===');
  const results = [];
  for (const ep of candidateEndpoints) {
    const res = await probeEndpoint(ep);
    results.push(res);
  }

  console.log('\n=== SURVEY SUMMARY TABLE ===');
  for (const r of results) {
    if (r.status === 'SUCCESS') {
      console.log(`[${r.endpoint}] (third-party server) TLS=${r.tls ? 'yes' : 'no'} | Status=OK | Branch=0x${r.consensusBranchId} | Upgrade=${r.upgradeName} | Tip=${r.blockHeight} | Vendor=${r.vendor} (${r.version}) | Node=${r.zcashdSubversion}`);
    } else {
      console.log(`[${r.endpoint}] (third-party server) TLS=${r.tls ? 'yes' : 'no'} | Status=FAIL | Error=${r.error}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});
