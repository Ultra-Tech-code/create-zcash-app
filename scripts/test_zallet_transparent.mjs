import fs from 'node:fs';

const ZALLET_URL = process.env.ZALLET_URL || 'http://127.0.0.1:8182';
const ZEBRA_URL = process.env.ZEBRA_URL || 'http://127.0.0.1:39232';

async function zalletRpc(method, params = []) {
  const auth = Buffer.from('zebra:zebra').toString('base64');
  const res = await fetch(ZALLET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!res.ok) {
    throw new Error(`Zallet HTTP error ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

async function zebraRpc(method, params = []) {
  const res = await fetch(ZEBRA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!res.ok) {
    throw new Error(`Zebra HTTP error ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

async function waitForOperation(opid, label = 'operation') {
  console.log(`Polling ${label} (opid=${opid})...`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await zalletRpc('z_getoperationstatus', [[opid]]);
    const op = st.result?.[0];
    console.log(`  Poll ${i}: status=${op?.status}`);
    if (op?.status === 'success') {
      return op.result.txid;
    }
    if (op?.status === 'failed') {
      throw new Error(`${label} failed: ${JSON.stringify(op.error)}`);
    }
  }
  throw new Error(`Timed out waiting for ${label} (${opid})`);
}

async function main() {
  console.log('=== ZALLET TRANSPARENT FUNDS & SPEND DETECTION TEST ===');
  console.log(`Date:       ${new Date().toISOString()}`);
  console.log(`Zallet RPC: ${ZALLET_URL}`);
  console.log(`Zebra RPC:  ${ZEBRA_URL}`);
  console.log('');

  // 1. Get Account 0 and transparent address
  console.log('--- 1. Deriving Transparent Address from Zallet Account ---');
  const accountsRes = await zalletRpc('z_listaccounts');
  const accounts = accountsRes.result;
  if (!accounts || accounts.length === 0) {
    throw new Error(`No accounts found in Zallet: ${JSON.stringify(accountsRes)}`);
  }
  const acctUuid = accounts[0].account_uuid;
  console.log(`Account 0 UUID: ${acctUuid}`);

  const addrRes = await zalletRpc('z_getaddressforaccount', [acctUuid]);
  const ua = addrRes.result.address;
  console.log(`Account 0 UA:   ${ua}`);

  const receiversRes = await zalletRpc('z_listunifiedreceivers', [ua]);
  const receivers = receiversRes.result;
  console.log('UA receivers:', JSON.stringify(receivers, null, 2));

  const taddr = receivers.p2pkh;
  if (!taddr) {
    throw new Error(`No p2pkh transparent receiver found in UA: ${JSON.stringify(receivers)}`);
  }
  console.log(`Extracted transparent address (taddr): ${taddr}`);

  const valRes = await zalletRpc('validateaddress', [taddr]);
  console.log('validateaddress(taddr):', JSON.stringify(valRes.result, null, 2));
  if (!valRes.result?.isvalid) {
    throw new Error(`validateaddress reported invalid for taddr: ${taddr}`);
  }
  console.log('[PASS] Transparent address is valid and owned by Account 0');
  console.log('');

  // 2. Initial balance
  console.log('--- 2. Initial Balance State ---');
  const initBal = await zalletRpc('z_gettotalbalance', [1, true]);
  console.log('Initial z_gettotalbalance [1, true]:');
  console.log(JSON.stringify(initBal.result, null, 2));
  const initWalletInfo = await zalletRpc('getwalletinfo');
  console.log('Initial getwalletinfo:');
  console.log(JSON.stringify(initWalletInfo.result, null, 2));
  console.log('');

  // 3. Fund taddr with 1.0 ZEC from Account UA
  console.log('--- 3. Funding Transparent Address (1.0 ZEC via z_sendmany) ---');
  const fundSendRes = await zalletRpc('z_sendmany', [
    ua,
    [{ address: taddr, amount: 1.0 }],
    1,
    null,
    'AllowRevealedRecipients',
  ]);
  if (fundSendRes.error) {
    throw new Error(`z_sendmany funding failed: ${JSON.stringify(fundSendRes.error)}`);
  }
  const fundOpid = fundSendRes.result;
  console.log(`Funding operation ID: ${fundOpid}`);
  const fundTxid = await waitForOperation(fundOpid, 'funding z_sendmany');
  console.log(`✅ Funding transaction broadcast successfully: ${fundTxid}`);

  console.log('Mining 1 block on Zebra to confirm funding transaction...');
  const mine1 = await zebraRpc('generate', [1]);
  console.log(`Mined block hash: ${mine1.result[0]}`);

  // Wait for Zallet to observe confirmed UTXO in both z_gettotalbalance and z_listunspent
  console.log('Waiting for Zallet to observe transparent UTXO...');
  let confirmedFundBal = null;
  let fundedUnspent = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const bal = await zalletRpc('z_gettotalbalance', [1, true]);
    const unspent = await zalletRpc('z_listunspent', [1, 999999, true, [taddr]]);
    if (bal.result?.transparent === '1.00000000' && unspent.result?.length > 0) {
      confirmedFundBal = bal.result;
      fundedUnspent = unspent.result;
      break;
    }
  }

  if (!confirmedFundBal) {
    confirmedFundBal = (await zalletRpc('z_gettotalbalance', [1, true])).result;
  }
  if (!fundedUnspent) {
    fundedUnspent = (await zalletRpc('z_listunspent', [1, 999999, true, [taddr]])).result || [];
  }

  console.log('');
  console.log('--- 4. Confirming Zallet Sees Funded Transparent UTXO ---');
  console.log('z_gettotalbalance [1, true] (after funding):');
  console.log(JSON.stringify(confirmedFundBal, null, 2));

  const fundedWalletInfo = await zalletRpc('getwalletinfo');
  console.log('getwalletinfo (after funding):');
  console.log(JSON.stringify(fundedWalletInfo.result, null, 2));

  console.log('z_listunspent on taddr (after funding):');
  console.log(JSON.stringify(fundedUnspent, null, 2));

  const fundedAcctBal = await zalletRpc('z_getbalanceforaccount', [acctUuid, 1]);
  console.log('z_getbalanceforaccount (after funding):');
  console.log(JSON.stringify(fundedAcctBal.result, null, 2));

  if (!fundedUnspent || fundedUnspent.length === 0) {
    throw new Error(`FAIL: Zallet did not observe transparent UTXO on ${taddr}`);
  }
  if (confirmedFundBal?.transparent !== '1.00000000') {
    throw new Error(`FAIL: Expected transparent balance 1.00000000, got ${confirmedFundBal?.transparent}`);
  }
  console.log('✅ [PASS] Zallet successfully detects transparent UTXO on taddr.');
  console.log('');

  // 5. Spend the transparent UTXO back to the UA (shielding it)
  console.log('--- 5. Spending Transparent UTXO (0.99 ZEC from taddr to UA) ---');
  console.log('Transparent balance before spend:');
  console.log(JSON.stringify(confirmedFundBal, null, 2));

  const spendSendRes = await zalletRpc('z_sendmany', [
    taddr,
    [{ address: ua, amount: 0.99 }],
    1,
    null,
    'AllowRevealedSenders',
  ]);
  if (spendSendRes.error) {
    throw new Error(`z_sendmany spend failed: ${JSON.stringify(spendSendRes.error)}`);
  }
  const spendOpid = spendSendRes.result;
  console.log(`Spend operation ID: ${spendOpid}`);
  const spendTxid = await waitForOperation(spendOpid, 'spending z_sendmany');
  console.log(`✅ Spend transaction broadcast successfully: ${spendTxid}`);

  console.log('Mining 1 block on Zebra to confirm spend transaction...');
  const mine2 = await zebraRpc('generate', [1]);
  console.log(`Mined block hash: ${mine2.result[0]}`);

  // Wait for Zallet to observe spent UTXO in both z_gettotalbalance and z_listunspent
  console.log('Waiting for Zallet to observe spent UTXO and update transparent balance...');
  let confirmedSpentBal = null;
  let postSpendUnspent = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const bal = await zalletRpc('z_gettotalbalance', [1, true]);
    const unspent = await zalletRpc('z_listunspent', [1, 999999, true, [taddr]]);
    if (bal.result?.transparent === '0.00000000' && unspent.result?.length === 0) {
      confirmedSpentBal = bal.result;
      postSpendUnspent = unspent.result;
      break;
    }
  }
  if (!confirmedSpentBal) {
    confirmedSpentBal = (await zalletRpc('z_gettotalbalance', [1, true])).result;
  }
  if (!postSpendUnspent) {
    postSpendUnspent = (await zalletRpc('z_listunspent', [1, 999999, true, [taddr]])).result || [];
  }

  console.log('');
  console.log('--- 6. Verifying Transparent Balance & UTXO State After Spend ---');
  console.log('z_gettotalbalance [1, true] (after spend):');
  console.log(JSON.stringify(confirmedSpentBal, null, 2));

  const postSpendWalletInfo = await zalletRpc('getwalletinfo');
  console.log('getwalletinfo (after spend):');
  console.log(JSON.stringify(postSpendWalletInfo.result, null, 2));

  console.log('z_listunspent on taddr (after spend):');
  console.log(JSON.stringify(postSpendUnspent, null, 2));

  const postSpendAcctBal = await zalletRpc('z_getbalanceforaccount', [acctUuid, 1]);
  console.log('z_getbalanceforaccount (after spend):');
  console.log(JSON.stringify(postSpendAcctBal.result, null, 2));

  console.log('');
  console.log('--- 7. Transparent Balance Summary & Spend Detection Verdict ---');
  console.log(`Transparent balance before spend: ${confirmedFundBal?.transparent} ZEC`);
  console.log(`Transparent balance after spend:  ${confirmedSpentBal?.transparent} ZEC`);
  console.log(`Unspent UTXOs on taddr before:    ${fundedUnspent?.length}`);
  console.log(`Unspent UTXOs on taddr after:     ${postSpendUnspent?.length}`);

  const utxoMarkedSpent = postSpendUnspent?.length === 0;
  const balanceUpdatedToZero = confirmedSpentBal?.transparent === '0.00000000';

  if (utxoMarkedSpent && balanceUpdatedToZero) {
    console.log('✅ VERDICT: PASS - Zallet correctly detects the transparent spend and updates transparent balance to 0.00000000.');
  } else {
    console.log('❌ VERDICT: FAIL - Zallet failed to mark UTXO spent or transparent balance did not update to 0.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
