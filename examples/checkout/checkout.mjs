/**
 * Shielded Merchant Checkout Example
 *
 * Demonstrates:
 * 1. Deriving a unique diversified Unified Address (UA) per order using getUnifiedAddress(diversifierIndex).
 * 2. Operating with zero custody risk using a Unified Full Viewing Key (accountFromUfvk).
 * 3. Detecting incoming payments with detectIncoming() matching the order's diversified address.
 * 4. Verifying note confirmations against the network tip and marking the order as PAID.
 */

import { createClient, accountFromUfvk, accountFromMnemonic, detectIncoming } from '@zcash-app/sdk';

const ENDPOINT = process.env.ZCASH_ENDPOINT || '127.0.0.1:39067';
const NETWORK = process.env.ZCASH_NETWORK || 'regtest';

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
      // In Orchard/Unified note decryption, note.recipient represents the diversified address
      const isMatch =
        note.recipient === order.paymentAddress ||
        (this.account.getUnifiedAddress(order.diversifierIndex) === note.recipient);

      if (isMatch && note.value >= order.amountZatoshis) {
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

// Runnable CLI demonstration
async function runDemo() {
  console.log('=== Shielded Checkout Service Demo ===\n');

  // Use test mnemonic for local demonstration
  const testMnemonic =
    process.env.ZCASH_MNEMONIC ||
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

  const checkout = new CheckoutService(testMnemonic, NETWORK, ENDPOINT);

  console.log(`Connecting to indexer at: ${ENDPOINT} (${NETWORK})`);

  // Step 1: Create an order
  const order = checkout.createOrder('ORD-90210', 100_000n); // 0.001 ZEC
  console.log(`Order Created:       ${order.id}`);
  console.log(`Diversifier Index:   ${order.diversifierIndex}`);
  console.log(`Amount:              ${order.amountZatoshis} zatoshis (0.001 ZEC)`);
  console.log(`Unique UA Address:   ${order.paymentAddress}\n`);

  // Step 2: Poll for payment
  console.log('Checking order status before payment...');
  let checked = await checkout.checkOrder(order.id, 1);
  console.log(`Initial Status:      ${checked.status}\n`);

  await checkout.close();
}

if (process.argv[1] && process.argv[1].endsWith('checkout.mjs')) {
  runDemo().catch(console.error);
}
