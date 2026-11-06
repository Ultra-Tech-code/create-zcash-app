import http from 'http';
import fs from 'fs';

const ZALLET_URL = 'http://127.0.0.1:48232';
const AUTH = Buffer.from('zebra:zebra').toString('base64');

async function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const req = http.request(ZALLET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${AUTH}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  const log = [];
  const append = (title, data) => {
    console.log(`=== ${title} ===`);
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    log.push(`=== ${title} ===\n` + (typeof data === 'string' ? data : JSON.stringify(data, null, 2)) + '\n');
  };

  append('zallet version info', { image: 'zodlinc/zallet@sha256:682ba6f9a9931ac25f6a2eb2218f39e0bf5295c3cbe4d8dfa3fc275c34559506' });

  // 1. getwalletinfo
  const walletInfo = await rpc('getwalletinfo');
  append('getwalletinfo', walletInfo);

  // 2. z_listaccounts
  const accounts = await rpc('z_listaccounts');
  append('z_listaccounts', accounts);

  // 3. z_listunspent (various signatures)
  const listUnspentDefault = await rpc('z_listunspent');
  append('z_listunspent (no params)', listUnspentDefault);

  const listUnspent0 = await rpc('z_listunspent', [0]);
  append('z_listunspent [0]', listUnspent0);

  const listUnspent1 = await rpc('z_listunspent', [1, 9999999, true]);
  append('z_listunspent [1, 9999999, true]', listUnspent1);

  // 4. z_listtransactions (check existence and fields)
  const listTxHelp = await rpc('help', ['z_listtransactions']);
  append('help z_listtransactions', listTxHelp);

  const listTx = await rpc('z_listtransactions');
  append('z_listtransactions', listTx);

  const listTx0 = await rpc('z_listtransactions', [0]);
  append('z_listtransactions [0]', listTx0);

  // Also check standard listtransactions
  const stdListTxHelp = await rpc('help', ['listtransactions']);
  append('help listtransactions', stdListTxHelp);

  const stdListTx = await rpc('listtransactions');
  append('listtransactions', stdListTx);

  // 5. z_sendmany
  // First get an address for sending
  let fromAddr = '';
  if (accounts.result && accounts.result.length > 0) {
    const acctUuid = accounts.result[0].account_uuid;
    const addrRes = await rpc('z_getaddressforaccount', [acctUuid]);
    append(`z_getaddressforaccount [${acctUuid}]`, addrRes);
    if (addrRes.result && addrRes.result.address) {
      fromAddr = addrRes.result.address;
    }
  }

  const destAddr = fromAddr; // loopback send to own address
  append('Preparing z_sendmany attempt', { from: fromAddr, to: destAddr, amount: 1.0 });

  const sendmanyRes = await rpc('z_sendmany', [
    fromAddr,
    [{ address: destAddr, amount: 1.0, memo: Buffer.from("Zallet NU7 spike test").toString('hex') }]
  ]);
  append('z_sendmany result', sendmanyRes);

  // If z_sendmany returns an opid, check z_getoperationstatus
  if (sendmanyRes.result) {
    const opid = sendmanyRes.result;
    append(`Checking z_getoperationstatus for opid ${opid}`, {});
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const opStatus = await rpc('z_getoperationstatus', [[opid]]);
      append(`z_getoperationstatus (poll ${i})`, opStatus);
      if (opStatus.result && opStatus.result[0] && ['success', 'failed'].includes(opStatus.result[0].status)) {
        break;
      }
    }
  }

  // Save log
  const logContent = log.join('\n');
  fs.writeFileSync('packages/core/tests/logs/zallet_nu7_spike.log', logContent);
  console.log('\nLogged to packages/core/tests/logs/zallet_nu7_spike.log');
}

run().catch(console.error);

