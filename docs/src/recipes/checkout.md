# Shielded Checkout Flow

This recipe demonstrates an end-to-end shielded merchant checkout flow using `@zcash-app/sdk` and `zcash-dev`.

In this pattern:
1. The merchant derives a **unique diversified Unified Address (UA)** for each order using `getUnifiedAddress(diversifierIndex)`.
2. The checkout service operates with **zero custody risk** using a Unified Full Viewing Key (`accountFromUfvk`), preventing fund loss even if the server is compromised.
3. The customer pays the order via a shielded transaction.
4. The merchant backend detects the deposit using `detectIncoming()` (or `watch()`), verifies block confirmations against the network tip, and marks the order as `PAID`.

A complete, runnable implementation is provided in [`examples/checkout/`](file:///examples/checkout/).

---

## 1. SDK API Signatures Used

This recipe uses real exports from [`packages/sdk/src/index.ts`](file:///packages/sdk/src/index.ts):

```typescript
// Key derivation & watch-only account initialization
export function accountFromUfvk(
  ufvk: Ufvk,
  network?: Network
): WatchOnlyAccount;

export function accountFromMnemonic(
  mnemonic: string,
  accountIndex?: number,
  network?: Network
): Account;

// Address diversification on Account and WatchOnlyAccount
getUnifiedAddress(diversifierIndex?: number): string;

// Incoming note detection
export async function detectIncoming(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number; endHeight?: number }
): Promise<{ notes: IncomingNote[]; spentNullifiers: Set<string> }>;

// Real-time polling watcher
export function watch(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  onNote: (note: IncomingNote) => void,
  opts?: { pollMs?: number }
): () => void;
```

---

## 2. Implementation: The Checkout Service

The following module implements order creation, unique address allocation, and payment verification:

```javascript
import { createClient, accountFromUfvk, accountFromMnemonic, detectIncoming, reverseTxid } from '@zcash-app/sdk';

export class CheckoutService {
  constructor(ufvkOrMnemonic, network = 'regtest', endpoint = '127.0.0.1:39067') {
    this.network = network;
    this.endpoint = endpoint;
    this.client = createClient({ endpoint, network });

    // Zero-custody: initialize with UFVK in production
    if (ufvkOrMnemonic.startsWith('uview')) {
      this.account = accountFromUfvk(ufvkOrMnemonic, network);
    } else {
      this.account = accountFromMnemonic(ufvkOrMnemonic, 0, network);
    }

    this.orders = new Map();
    this.nextDiversifier = 1;
  }

  // 1. Create order with unique diversified payment address
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

  // 2. Poll for payment and assert confirmation threshold
  async checkOrder(orderId, requiredConfs = 1) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status === 'PAID') return order;

    const info = await this.client.getInfo();
    const currentHeight = Number(info.blockHeight);

    const { notes } = await detectIncoming(this.client, this.account, { sinceHeight: 1 });

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
```

---

## 3. End-to-End Execution on NU7 Regtest

The complete checkout lifecycle was executed against a clean NU7 regtest stack (`zcash-dev regtest up --stack nu7`).

### Machine-Captured Execution Log
The following output is verbatim from [`packages/core/tests/logs/recipe_checkout_nu7.log`](file:///packages/core/tests/logs/recipe_checkout_nu7.log) (SHA-256: `46060db05e47834bf6d69269141a2bdffcf3118fc44d6744cec9d3678bfa7dd2`):

```text
========================================================================
RECIPE 1: SHIELDED CHECKOUT FLOW — NU7 REGTEST END-TO-END
========================================================================
Timestamp: 2026-11-04T19:50:18.639Z
Network:   regtest
Endpoint:  127.0.0.1:39067
Zebra RPC: http://127.0.0.1:39232
------------------------------------------------------------------------

[1/5] Verified node & indexer connection:
      Block Height:   4
      Active Branch:  77190ad9
      Network:        test

[2/5] Initialized Merchant Watch-Only Checkout Authority:
      Merchant UFVK:  uviewregtest1df3vq7x64yhq7638ym8...
      Base UA:        uregtest17h4287clmqngsz89gwpzttkgty...

[3/5] Created Order ORD-8821:
      Diversifier Index: 1
      Payable UA:        uregtest17h4287clmqngsz89gwpzttkgty0rja66mwmpqst354n2q2qk5q5nlrvt52ezv3w59uwehpekq2qx6y9zyc7jzsw5u4qerf43hc550mctvh00gh5gsuyaacvgh7memgtaafzg3q2cne8hvpm5z7yut2matdxudq9smkfmdte56kqfj8jqy23reh6pwy3yu0h5pm99wryycpfesnegnd5
      Required Amount:   100000 zatoshis (0.00100000 ZEC)
      Initial Status:    PENDING

[4/5] Customer broadcasts payment transaction:
      Payer Address:     uregtest1cjtspq0p660zrmhwn8uhzugwpx...
      Destination:       uregtest17h4287clmqngsz89gwpzttkgty0rja66mwmpqst354n2q2qk5q5nlrvt52ezv3w59uwehpekq2qx6y9zyc7jzsw5u4qerf43hc550mctvh00gh5gsuyaacvgh7memgtaafzg3q2cne8hvpm5z7yut2matdxudq9smkfmdte56kqfj8jqy23reh6pwy3yu0h5pm99wryycpfesnegnd5
      Amount:            0.00100000 ZEC
      Broadcast TxID:    9ef4d7013d09f90ed66f96a238135dcf18b22bc23e9b41180b864fb540a2521e
      Mining 1 block to confirm transaction...
      Mined Block Hash:  90f3ced12cf03502af357e5da0147ba6025a1d8f279e3a6d980ae945292d775c

[5/5] Merchant detects incoming payment note:
      Detected Note TxID: 5869aea1cbcddc549d79366ac3af48621f80648abe2a1ad1d0330283b65aae72
      Value Received:     100000 zatoshis (0.00100000 ZEC)
      Block Height:       4
      Confirmations:      2
      Payment Address:    uregtest17h4287clmqngsz89gwpzttkgty0rja66mwmpqst354n2q2qk5q5nlrvt52ezv3w59uwehpekq2qx6y9zyc7jzsw5u4qerf43hc550mctvh00gh5gsuyaacvgh7memgtaafzg3q2cne8hvpm5z7yut2matdxudq9smkfmdte56kqfj8jqy23reh6pwy3yu0h5pm99wryycpfesnegnd5
      Order Status:       PAID ✅

========================================================================
CHECKOUT RECIPE COMPLETED SUCCESSFULLY
========================================================================
```

---

## 4. Key Takeaways

1. **Address Unlinkability**: Deriving a distinct diversifier for each order prevents third parties from correlating separate checkout transactions on-chain.
2. **Zero-Custody Operation**: The backend service requires only `ZCASH_UFVK` to decrypt notes and confirm payments; no private keys reside on the application server.
3. **Byte Order in TxIDs**: The CLI output displays txids in big-endian explorer format, while raw protobuf lightwalletd transactions use internal little-endian byte ordering. Use `reverseTxid()` from `@zcash-app/sdk` when comparing transaction identifiers.
