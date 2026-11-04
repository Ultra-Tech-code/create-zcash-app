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
The following output is verbatim from [`packages/core/tests/logs/recipe_payroll_nu7.log`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/core/tests/logs/recipe_payroll_nu7.log) (SHA-256: `bdd5d2712568c6941f6bf36dfdea540bcc94ff1dba762d63a8901334fec54eb0`):

```text
========================================================================
RECIPE 3: DISBURSEMENT & PAYROLL — 3-RECIPIENT SEQUENTIAL BATCH RUN
========================================================================
Timestamp: 2026-11-04T20:38:59.004Z
Network:   regtest-nu7
Endpoint:  127.0.0.1:39067
------------------------------------------------------------------------

[1/4] Loaded Payroll Roster:
      Employee 1: Alice (Lead Core Developer)
        Address: uregtest13jg4w82j24qcany0njckg29lj3...
        Amount:  0.0005 ZEC (50000 zatoshis)
        Memo:    "Payroll: 2026-11 Alice Core Dev"
      Employee 2: Bob (Security Researcher)
        Address: uregtest1kgm3kspdy636u3e7jmnw57dxdu...
        Amount:  0.0007 ZEC (70000 zatoshis)
        Memo:    "Payroll: 2026-11 Bob Security Audit"
      Employee 3: Charlie (Infrastructure Eng)
        Address: uregtest1wn0v08hx44ad9djs2vfem6ujef...
        Amount:  0.0009 ZEC (90000 zatoshis)
        Memo:    "Payroll: 2026-11 Charlie Infra Ops"

[2/4] Executing Sequential Disbursement Transactions:
      Note: SDK and CLI currently support 1 recipient per transaction.
      Each disbursement requires a separate transaction, ZIP-317 fee,
      and anchor confirmation for sequential note spendability.

      --> Processing payment 1/3 to Alice (Lead Core Developer)...
          TxID:        efa564873115442f18cac27d17af1b964e74d9f6f62c3851f76036aa51cf93e4
          ZIP-317 Fee: 10000 zatoshis
          Mining block to confirm change note & update anchor...
          Confirmed in block: 79a713ad4c1c42645d9aca1940a8e509a92c781c8816c06661be341358351d5f

      --> Processing payment 2/3 to Bob (Security Researcher)...
          TxID:        5b76fd21c8b045a854532788c5fea5e2720bcec5189c194f0509102e95e601a2
          ZIP-317 Fee: 10000 zatoshis
          Mining block to confirm change note & update anchor...
          Confirmed in block: a018f93a206c476cdd1fa5970ce212b8b8c194cdb5f7379a9292c9990357e137

      --> Processing payment 3/3 to Charlie (Infrastructure Eng)...
          TxID:        161c55419d02c5843beab6f0601313493d782e59dd9065480fff0009f2654d70
          ZIP-317 Fee: 10000 zatoshis
          Mining block to confirm change note & update anchor...
          Confirmed in block: fff8c92e4b2e590799e4c4b070a85d6c43c05592336c0bfb61850f84958ddda6

[3/4] Verifying Payee Balances Post-Disbursement:
      Alice (Lead Core Developer):
        Confirmed Balance: 50000 zatoshis (0.00050000 ZEC)
        Orchard Confirmed: 0 zatoshis
      Bob (Security Researcher):
        Confirmed Balance: 70000 zatoshis (0.00070000 ZEC)
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
