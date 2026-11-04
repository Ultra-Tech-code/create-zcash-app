# Disbursement & Payroll

This recipe covers automated disbursement and employee payroll processing using `create-zcash-app` and `@zcash-app/sdk`.

---

## 1. Single-Recipient Architecture & Current Capabilities

> [!IMPORTANT]
> **Current SDK & CLI Capabilities**: As of `@zcash-app/sdk` and `zcash-dev` version `0.1.0-alpha.2`, the transaction send pipeline supports **one recipient per transaction**. The SDK `SendOptions` interface declares a single `to: string` destination:
> ```typescript
> export interface SendOptions {
>   client: ZcashClient;
>   wallet: WalletHandle;
>   from?: SendFromOptions | Account | number;
>   to: string; // Exactly one recipient address
>   amount: bigint | number;
>   memo?: string;
>   minConfs?: number;
>   anchorHeight?: number;
> }
> ```
> The CLI `zcash-dev send` similarly requires a single `--to <address>` argument. Multi-recipient batch transactions in a single transaction bundle are **not supported in the current release**.

---

## 2. The Sequential Loop Approach & Operational Constraints

To execute a disbursement batch across a roster of payees, the application executes a sequential payment loop. When implementing this pattern, developers must account for the following protocol behaviors:

1. **Transaction Fees**: Because each payout is a distinct transaction, a separate [ZIP 317](https://zips.z.cash/zip-0317) fee is incurred per recipient (10,000 zatoshis per standard 2-action transaction). A roster of 10 payees will pay 100,000 zatoshis in aggregate network fees.
2. **Change Outputs & Anchor Maturity**: When an account spends a note, the remaining unspent value is returned to the account as an internal change note. Under Zcash consensus rules, that change output cannot be spent as an anchor input for another transaction until the transaction is mined into a block.
3. **Loop Sequencing**: If an account does not hold multiple pre-split spendable notes, each transaction must wait for block confirmation (`zcash-dev mine 1` on regtest or ~75 seconds on mainnet/testnet) before constructing the subsequent payment in the loop.

---

## 3. Implementation: Automated Payroll Loop

```javascript
import { createClient, accountFromMnemonic, getBalance } from '@zcash-app/sdk';
import { execSync } from 'node:child_process';

export async function processPayroll(employees, employerMnemonic, endpoint = '127.0.0.1:39067') {
  const client = createClient({ endpoint, network: 'regtest' });
  const employerAcct = accountFromMnemonic(employerMnemonic, 0, 'regtest');

  console.log(`Processing payroll for ${employees.length} employees...`);

  const results = [];

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    console.log(`Processing [${i + 1}/${employees.length}] -> ${emp.name} (${emp.amountZec} ZEC)`);

    // 1. Broadcast payment via zcash-dev send
    const sendCmd = `zcash-dev send --to "${emp.address}" --amount "${emp.amountZec}" --memo "${emp.memo}" --endpoint "${endpoint}" --yes`;
    const output = execSync(sendCmd, {
      env: { ...process.env, ZCASH_MNEMONIC: employerMnemonic },
    }).toString();

    const txidMatch = output.match(/Txid:\s+([0-9a-fA-F]{64})/);
    const txid = txidMatch ? txidMatch[1] : 'unknown';

    // 2. Wait for block confirmation so change notes mature into spendable anchors
    // On regtest, mine 1 block:
    execSync('zcash-dev mine 1');

    results.push({ employee: emp.name, txid, amount: emp.amountZec });
  }

  await client.close();
  return results;
}
```

---

## 4. End-to-End Execution on NU7 Regtest (3-Recipient Batch)

The payroll loop was executed against the active NU7 regtest stack (`127.0.0.1:39067`) paying 3 test employees: Alice, Bob, and Charlie.

### Machine-Captured Execution Log
The following output is verbatim from [`packages/core/tests/logs/recipe_payroll_nu7.log`](file:///packages/core/tests/logs/recipe_payroll_nu7.log) (SHA-256: `21252c879183370cddbd0b013402922a0091dc9f65731a369c490049c65c32c8`):

```text
========================================================================
RECIPE 3: DISBURSEMENT & PAYROLL — 3-RECIPIENT SEQUENTIAL BATCH RUN
========================================================================
Timestamp: 2026-11-04T19:50:27.510Z
Network:   regtest
Endpoint:  127.0.0.1:39067
------------------------------------------------------------------------

[1/4] Loaded Payroll Roster:
      Employee 1: Alice (Lead Core Developer)
        Address: uregtest17h4287clmqngsz89gwpzttkgty...
        Amount:  0.0005 ZEC (50000 zatoshis)
        Memo:    "Payroll: 2026-11 Alice Core Dev"
      Employee 2: Bob (Security Researcher)
        Address: uregtest1pdyndx5k5yuyncf6w6lumxxmdv...
        Amount:  0.0007 ZEC (70000 zatoshis)
        Memo:    "Payroll: 2026-11 Bob Security Audit"
      Employee 3: Charlie (Infrastructure Eng)
        Address: uregtest1kpzkz5yz4pgddlr73j26sapd0c...
        Amount:  0.0009 ZEC (90000 zatoshis)
        Memo:    "Payroll: 2026-11 Charlie Infra Ops"

[2/4] Executing Sequential Disbursement Transactions:
      Note: SDK and CLI currently support 1 recipient per transaction.
      Each disbursement requires a separate transaction, ZIP-317 fee,
      and anchor confirmation for sequential note spendability.

      --> Processing payment 1/3 to Alice (Lead Core Developer)...
          TxID:        bbbf4f8327518e96835a2b1c8f0323e8db9bc1761c46d1ca378245d9a961c006
          ZIP-317 Fee: 10000 zatoshis
          Mining block to confirm change note & update anchor...
          Confirmed in block: fbb89f7622ceab00438586798d3baae42ee7f9b93d5413fea18ebc8aa499f801

      --> Processing payment 2/3 to Bob (Security Researcher)...
          TxID:        0b4670c719ac78b85d33ec21b56a78d98091349e52b0bd5826d2c491553f328b
          ZIP-317 Fee: 10000 zatoshis
          Mining block to confirm change note & update anchor...
          Confirmed in block: bf9d5953d77db9f6abb32b34e7a70ce99085869a24e4a4c68bbced8327d8046d

      --> Processing payment 3/3 to Charlie (Infrastructure Eng)...
          TxID:        9cd4322caa0ef34bcc383f6b5d9a249d5360398201c21ea2d6bbb4d76a463b36
          ZIP-317 Fee: 10000 zatoshis
          Mining block to confirm change note & update anchor...
          Confirmed in block: 7437068b3b578e580e4a3ecb3a1d0696e14013962c5b87b997e6a49183fdb4ab

[3/4] Verifying Payee Balances Post-Disbursement:
      Alice (Lead Core Developer):
        Confirmed Balance: 250000 zatoshis (0.00250000 ZEC)
        Orchard Confirmed: 0 zatoshis
      Bob (Security Researcher):
        Confirmed Balance: 270000 zatoshis (0.00270000 ZEC)
        Orchard Confirmed: 0 zatoshis
      Charlie (Infrastructure Eng):
        Confirmed Balance: 90000 zatoshis (0.00090000 ZEC)
        Orchard Confirmed: 0 zatoshis

[4/4] Batch Summary:
      Total Employees Paid: 3
      Total Disbursed:      210000 zatoshis (0.00210000 ZEC)
      Total ZIP-317 Fees:   30000 zatoshis (0.00030000 ZEC)
      Total Net Outflow:    240000 zatoshis (0.00240000 ZEC)

========================================================================
PAYROLL RECIPE COMPLETED SUCCESSFULLY
========================================================================
```
