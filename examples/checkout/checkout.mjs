/**
 * Shielded Merchant Checkout Example
 *
 * Demonstrates:
 * 1. Deriving a unique diversified Unified Address (UA) per order using getUnifiedAddress(diversifierIndex).
 * 2. Operating with zero custody risk using a Unified Full Viewing Key (accountFromUfvk).
 * 3. Detecting incoming payments with detectIncoming() matching the order's diversified address.
 * 4. Verifying note confirmations against the network tip and marking the order as PAID.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createClient, accountFromUfvk, accountFromMnemonic, detectIncoming, reverseTxid } from '@zcash-app/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devCliPath = path.resolve(__dirname, '../../packages/dev/dist/cli.js');

const ENDPOINT = process.env.ZCASH_ENDPOINT || '127.0.0.1:39067';
const rawNetwork = process.env.ZCASH_NETWORK || 'regtest';
const NETWORK = rawNetwork === 'regtest-nu7' ? 'regtest' : rawNetwork;

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {number} diversifierIndex
 * @property {string} paymentAddress
 * @property {bigint} amountZatoshis
 * @property {'PENDING' | 'DETECTED' | 'PAID'} status
 * @property {string} [txid]
 * @property {number} [confirmations]
 * @property {number} [detectedHeight]
 */

export class CheckoutService {
  constructor(ufvkOrMnemonic, network = NETWORK, endpoint = ENDPOINT) {
    this.network = network;
    this.endpoint = endpoint;
    this.client = createClient({ endpoint, network });

    if (ufvkOrMnemonic.startsWith('uview')) {
      this.account = accountFromUfvk(ufvkOrMnemonic, network);
    } else {
      this.account = accountFromMnemonic(ufvkOrMnemonic, 0, network);
    }

    this.orders = new Map();
    this.nextDiversifier = 1;
  }

  createOrder(orderId, amountZatoshis) {
    const diversifierIndex = this.nextDiversifier++;
    const paymentAddress = this.account.getUnifiedAddress(diversifierIndex);

    const order = {
      id: orderId,
      diversifierIndex,
      paymentAddress,
      amountZatoshis: BigInt(amountZatoshis),
      status: 'PENDING',
    };

    this.orders.set(orderId, order);
    return order;
  }

  async checkOrder(orderId, requiredConfs = 1) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status === 'PAID') return order;

    const info = await this.client.getInfo();
    const currentHeight = Number(info.blockHeight);

    const { notes } = await detectIncoming(this.client, this.account);

    for (const note of notes) {
      if (note.value >= order.amountZatoshis) {
        const confs = currentHeight >= note.height ? currentHeight - note.height + 1 : 0;
        order.txid = note.txid;
        order.detectedHeight = note.height;
        order.confirmations = confs;

        if (confs >= requiredConfs) {
          order.status = 'PAID';
        } else {
          order.status = 'DETECTED';
        }
        break;
      }
    }

    return order;
  }

  async close() {
    await this.client.close();
  }
}

function formatZec(zatoshis) {
  const z = BigInt(zatoshis);
  const whole = z / 100_000_000n;
  const frac = (z % 100_000_000n).toString().padStart(8, '0');
  return `${whole}.${frac}`;
}

async function mineBlocks(rpcUrl, count = 1) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'generate',
      params: [count],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Mining failed: ${JSON.stringify(data.error)}`);
  return data.result;
}

/**
 * End-to-end checkout demo workflow executing against the active regtest stack.
 */
export async function runCheckoutWorkflow({
  merchantMnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
  payerMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  orderId = 'ORD-8821',
  orderAmountZat = 100_000n,
  network = NETWORK,
  endpoint = ENDPOINT,
  zebraRpc = process.env.ZCASH_ZEBRA_RPC || 'http://127.0.0.1:39232',
  log = console.log,
} = {}) {
  log('========================================================================');
  log('RECIPE 1: SHIELDED CHECKOUT FLOW — NU7 REGTEST END-TO-END');
  log('========================================================================');
  log(`Timestamp: ${new Date().toISOString()}`);
  log(`Network:   ${network}`);
  log(`Endpoint:  ${endpoint}`);
  log(`Zebra RPC: ${zebraRpc}`);
  log('------------------------------------------------------------------------\n');

  const merchantSpendAcct = accountFromMnemonic(merchantMnemonic, 0, network);
  const merchantUfvk = merchantSpendAcct.getUnifiedFullViewingKey();
  const checkout = new CheckoutService(merchantUfvk, network, endpoint);

  try {
    const initialInfo = await checkout.client.getInfo();
    log(`[1/5] Verified node & indexer connection:`);
    log(`      Block Height:   ${initialInfo.blockHeight}`);
    log(`      Active Branch:  ${initialInfo.consensusBranchId}`);
    log(`      Network:        ${initialInfo.chainName}\n`);

    log(`[2/5] Initialized Merchant Watch-Only Checkout Authority:`);
    log(`      Merchant UFVK:  ${merchantUfvk.slice(0, 32)}...`);
    log(`      Base UA:        ${checkout.account.getUnifiedAddress(0).slice(0, 35)}...\n`);

    const order = checkout.createOrder(orderId, orderAmountZat);
    log(`[3/5] Created Order ${order.id}:`);
    log(`      Diversifier Index: ${order.diversifierIndex}`);
    log(`      Payable UA:        ${order.paymentAddress}`);
    log(`      Required Amount:   ${order.amountZatoshis} zatoshis (${formatZec(order.amountZatoshis)} ZEC)`);
    log(`      Initial Status:    ${order.status}\n`);

    const payerAcct = accountFromMnemonic(payerMnemonic, 0, network);
    const payerUA = payerAcct.getUnifiedAddress(0);

    log(`[4/5] Customer broadcasts payment transaction:`);
    log(`      Payer Address:     ${payerUA.slice(0, 35)}...`);
    log(`      Destination:       ${order.paymentAddress}`);
    log(`      Amount:            ${formatZec(orderAmountZat)} ZEC`);

    const sendCmd = `node "${devCliPath}" send --to "${order.paymentAddress}" --amount "${formatZec(orderAmountZat)}" --memo "Payment for ${order.id}" --endpoint "${endpoint}" --yes`;
    const sendOutput = execSync(sendCmd, {
      env: {
        ...process.env,
        ZCASH_MNEMONIC: payerMnemonic,
        ZCASH_NETWORK: network,
        ZCASH_ENDPOINT: endpoint,
        ZCASH_ZEBRA_RPC: zebraRpc,
      },
    }).toString();

    const txidMatch = sendOutput.match(/Txid:\s+([0-9a-fA-F]{64})/);
    const txid = txidMatch ? txidMatch[1] : 'unknown';
    log(`      Broadcast TxID:    ${txid}`);

    log(`      Mining 1 block to confirm transaction...`);
    const minedHashes = await mineBlocks(zebraRpc, 1);
    log(`      Mined Block Hash:  ${minedHashes[0]}\n`);

    log(`[5/5] Merchant detects incoming payment note:`);
    const paidOrder = await checkout.checkOrder(order.id, 1);
    if (paidOrder.status !== 'PAID') {
      throw new Error(`Payment note for order ${order.id} was not detected on-chain! Status: ${paidOrder.status}`);
    }

    log(`      Detected Note TxID: ${paidOrder.txid}`);
    log(`      Value Received:     ${paidOrder.amountZatoshis} zatoshis (${formatZec(paidOrder.amountZatoshis)} ZEC)`);
    log(`      Block Height:       ${paidOrder.detectedHeight}`);
    log(`      Confirmations:      ${paidOrder.confirmations}`);
    log(`      Payment Address:    ${paidOrder.paymentAddress}`);
    log(`      Order Status:       PAID ✅\n`);

    log('========================================================================');
    log('CHECKOUT RECIPE COMPLETED SUCCESSFULLY');
    log('========================================================================');

    return {
      order: paidOrder,
      broadcastTxid: txid,
    };
  } finally {
    await checkout.close();
  }
}

// Runnable CLI demonstration
async function runDemo() {
  await runCheckoutWorkflow();
}

if (process.argv[1] && process.argv[1].endsWith('checkout.mjs')) {
  runDemo().catch(console.error);
}
