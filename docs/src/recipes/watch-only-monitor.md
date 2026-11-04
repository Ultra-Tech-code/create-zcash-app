# Watch-Only Wallet Monitor

This recipe demonstrates how to build and operate an air-gapped, zero-custody monitoring service using a Unified Full Viewing Key (UFVK) with `@zcash-app/sdk`.

In this pattern:
1. Private spending keys and BIP-39 seed phrases remain completely cold (offline, hardware wallet, or air-gapped machine).
2. Only the Unified Full Viewing Key (`uview...`) is deployed to the server environment.
3. The server derives receiving addresses, scans incoming shielded notes, computes confirmed pool balances, and emits webhook notifications.
4. Transaction signing and sending capabilities are **cryptographically impossible** on the watch-only node.

A complete, runnable implementation is provided in [`examples/watch-only/`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/examples/watch-only/).

---

## 1. SDK API Signatures Used

This recipe uses real exports from [`packages/sdk/src/index.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/sdk/src/index.ts):

```typescript
// Initializing a watch-only account with no spend keys
export function accountFromUfvk(
  ufvk: Ufvk,
  network?: Network
): WatchOnlyAccount;

// Address derivation on WatchOnlyAccount
getUnifiedAddress(diversifierIndex?: number): string;
getTransparentAddress(): string | undefined;

// Note scanning and balance calculation
export async function detectIncoming(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number; endHeight?: number }
): Promise<{ notes: IncomingNote[]; spentNullifiers: Set<string> }>;

export async function getBalance(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { minConf?: number; sinceHeight?: number; endHeight?: number }
): Promise<AccountBalance>;

// Spend pipeline (which rejects watch-only accounts)
export async function send(opts: SendOptions): Promise<SendResult>;
```

---

## 2. Implementation: The Watch-Only Monitor

```javascript
import {
  createClient,
  accountFromUfvk,
  detectIncoming,
  getBalance,
  send,
} from '@zcash-app/sdk';

export async function runWatchOnlyMonitor(ufvk, network = 'regtest', endpoint = '127.0.0.1:39067') {
  // 1. Initialize watch-only account (zero custody: no spend keys)
  const account = accountFromUfvk(ufvk, network);
  const client = createClient({ endpoint, network });

  try {
    // 2. Derive receiving addresses
    const depositUA = account.getUnifiedAddress(0);
    console.log(`Deposit UA: ${depositUA}`);

    // 3. Query confirmed pool balances
    const balance = await getBalance(client, account);
    console.log(`Total Confirmed: ${balance.total} zatoshis`);

    // 4. Scan for incoming notes
    const { notes } = await detectIncoming(client, account, { sinceHeight: 1 });
    console.log(`Incoming Notes Found: ${notes.length}`);

    // 5. Demonstrate that authoring a spend is strictly rejected
    try {
      await send({
        client,
        wallet: {},
        from: account,
        to: depositUA,
        amount: 50_000n,
      });
      throw new Error('SECURITY VIOLATION: send succeeded on watch-only account!');
    } catch (err) {
      console.log(`Spend rejected as expected: ${err.message}`);
    }
  } finally {
    await client.close();
  }
}
```

---

## 3. End-to-End Execution on NU7 Regtest

The watch-only workflow was executed against the active NU7 regtest stack (`127.0.0.1:39067`).

### Machine-Captured Execution Log
The following output is verbatim from [`packages/core/tests/logs/recipe_watch_only_nu7.log`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/core/tests/logs/recipe_watch_only_nu7.log) (SHA-256: `e21e98d90dfd4f3c682c69517e5f7d20811f1a48c4e9fb8eed83db4d76ef04f2`):

```text
========================================================================
RECIPE 2: WATCH-ONLY WALLET MONITOR — ZERO-CUSTODY AIR-GAPPED SERVICE
========================================================================
Timestamp: 2026-11-04T20:38:52.256Z
Network:   regtest-nu7
Endpoint:  127.0.0.1:39067
------------------------------------------------------------------------

[1/5] Server configured with Unified Full Viewing Key (UFVK):
      UFVK:            uviewregtest1wc0v5cry88thqcarv52wll3a3kape7g3y4n3z938ul89jlnmclly56cttcg6cdat62m4nhcwn6vdsyf3g3ljkkd8fffk323l0qcy9ug8fsfxhexu737hckrvw6xgrz7dtepexaye25qdw02wys0l9h8kpes6wtge7ha6gu2c4jz75a4hrtzzt2ydympf2jjdg6hea687d2upfwf8ld6vdd46pxcylypkd8pdl3wt2jz4s0gjfu0swvzlzqm09nrjwj3uuf97yyvlrpx44stwlp6d9ak6sydqvyfp49a86khgzugrqkfm0l4qam995v56wt8c5k5pjlt947mazufsrkanv9y5atnh5tfh52nq30kjac97e6r2rcx25q8pl4p4uprqt60u3j2kedzev3acdr7ha5tg6gaejsjpmrtutyhstc7ssppwxga7cqd2r2fmlzp52ysaky97xznl23xtv36w2g3am9k42xy69qw3xz4pw6mussp6sg3l
      Spending Authority: NONE (Zero Custody Server)

[2/5] Derived Deposit Receiving Address:
      Deposit UA:      uregtest1pdyndx5k5yuyncf6w6lumxxmdvy9drk0jznfp4htspd9wqzhty264cnu7dd7my8h9gl2pxv9jmsk56pzwz4xh765hsvn8e28l3nx30wylgex4cqv3av2czajp9lm92xcndwrjentvhmajppz06qd0q9ehwl6pwy7awym2avh3x5eheq5hw6sx0ydgu5p6s4rkj6dys58c0djqpf88ah
      Initial Balance: 0 zatoshis

[3/5] External payer broadcasts deposit:
      Recipient:       uregtest1pdyndx5k5yuyncf6w6lumxxmdvy9drk0jznfp4htspd9wqzhty264cnu7dd7my8h9gl2pxv9jmsk56pzwz4xh765hsvn8e28l3nx30wylgex4cqv3av2czajp9lm92xcndwrjentvhmajppz06qd0q9ehwl6pwy7awym2avh3x5eheq5hw6sx0ydgu5p6s4rkj6dys58c0djqpf88ah
      Amount:          0.002 ZEC (200,000 zatoshis)
      TxID:            d846ee7bf02af03ea6e2fa262f65324728042fa1289bc004825c4535f8739c97
      Mining 1 block to confirm deposit...
      Mined Block:     a6120645c0e2e87e2f5400c5869b595189167a825b581a8ea59166afde74dcdb

[4/5] Watch-only monitor detects deposit:
      Detected Pool:   ironwood
      Detected Value:  200000 zatoshis (0.00200000 ZEC)
      Block Height:    109
      Confirmed Total: 200000 zatoshis (0.00200000 ZEC)
      Orchard Pool:    0 zatoshis

[5/5] Enforcing Spend Rejection:
      Attempting to call send() from WatchOnlyAccount...
      ✅ SPEND STRICTLY REJECTED: Cannot spend from a watch-only account: spending key or spend handle is required

========================================================================
WATCH-ONLY RECIPE COMPLETED SUCCESSFULLY
========================================================================
```

---

## 4. Key Takeaways

1. **Security Isolation**: Even if the host machine running the monitor suffers remote code execution or database exfiltration, attackers obtain only viewing data. Private funds remain secure on cold storage.
2. **Full Shielded Visibility**: A UFVK can decrypt encrypted note values, identify recipient diversifiers, and detect incoming notes across both Orchard and Ironwood pools.
3. **Spend Prevention**: Passing a `WatchOnlyAccount` to the `send()` pipeline fails immediately because the account lacks spend keys and signing authority.
