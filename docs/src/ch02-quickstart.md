# Chapter 2: Quickstart

In this quickstart, you will scaffold a new shielded Zcash application, initialize an isolated local NU7 regtest devnet, fund an account, run the application, and simulate your first shielded payment.

> [!NOTE]
> The commands below need create-zcash-app / zcash-dev 0.1.0-alpha.5 or later (alpha.5 is the current release, featuring full NU7 stack support, `address`, `balance`, and `send` commands).

## Prerequisites

- **Node.js**: v20 or v22 LTS
- **pnpm**: v9 or v11 (or npm / yarn)
- **Docker & Docker Compose**: Required for running the local Zebra + lightwalletd devnet

---

## Step 1: Scaffold Your Application

Run the scaffolder CLI to generate a new application. You can provide flags directly or walk through the interactive wizard:

```bash
npx create-zcash-app my-shielded-app --network regtest --regtest-stack lightwalletd --key-source generate
```

Navigate into your new project directory and install dependencies:

```bash
cd my-shielded-app
pnpm install
```

### Generated Project Structure

The project includes:

- `zcash.config.json`: Public configuration containing network target, indexer endpoints, and connection mode.
- `.env.local`: Private environment configuration holding your derived mnemonic (`ZCASH_MNEMONIC`) and secret RPC URLs. This file is gitignored.
- `app/`: Next.js App Router full-stack template with account summary, transaction dry-runner, and real-time status routes.

---

## Step 2: Inspect Your Configured Account Address

Verify that your project's `.env.local` contains a valid spending key and view your derived Unified Address (UA):

```bash
npx zcash-dev address
```

Example output:

```text
--- Configured Account Address ---
Network:          regtest
Account Index:    0
Unified Address:  uregtest1zchcl4t6stdjf23589hkrr3pmsslk36t8arszjz79vhj3p2gqpedfgztltegzj9phkqn6h5xdyg6n7xg9p08mg26q6932d4rhty9mnj6gzuzgsjst63m447gdzxynypht3lc5pzh5l5kj37dfscug9e2c7mn882v9wwruhxuww3u2kzvd4y8wkpckwtkkru7ympc4q2r3yqu7rlpdg4
Transparent:      tmPjvZk15G2tbhjTamFfCygS8yvDPyfYQQR
```

---

## Step 3: Launch Local Regtest Devnet (`--stack lightwalletd`)

To test locally without spending real or testnet funds, launch the isolated regtest environment (powered by Zebra 7.0.0 and lightwalletd):

```bash
npx zcash-dev regtest up --stack lightwalletd
```

This command:
1. Configures `zebra.toml` with the miner address from Account 0.
2. Starts the Zebra and lightwalletd Docker containers.
3. Automatically mines 110 initial blocks to satisfy coinbase maturity requirements (coinbase outputs require 100 confirmations to spend).

Verify running containers:

```bash
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
```

Output:

```text
zcash-regtest-lightwalletd-lightwalletd-1 electriccoinco/lightwalletd 127.0.0.1:39067->9067/tcp, 127.0.0.1:39068->9068/tcp
zcash-regtest-lightwalletd-zebra-1 zfnd/zebra:7.0.0 127.0.0.1:38080->8080/tcp, 127.0.0.1:39232->18232/tcp
```

---

## Step 4: Mine Blocks & Fund Accounts

To fund any Unified Address on the devnet from the miner account, execute:

```bash
npx zcash-dev fund uregtest1zchcl4t6stdjf23589hkrr3pmsslk36t8arszjz79vhj3p2gqpedfgztltegzj9phkqn6h5xdyg6n7xg9p08mg26q6932d4rhty9mnj6gzuzgsjst63m447gdzxynypht3lc5pzh5l5kj37dfscug9e2c7mn882v9wwruhxuww3u2kzvd4y8wkpckwtkkru7ympc4q2r3yqu7rlpdg4 5.0
```

Output:

```text
[Sync] (http://127.0.0.1:39067) (local) Starting sync from height 2 to target 112 (tip: 112, batch size: 1000, throttle: 50ms)...
[Sync] (http://127.0.0.1:39067) (local) Height: 112/112 (100.0%) | Req: 113 | Speed: 123.9 blocks/s
[Sync] (http://127.0.0.1:39067) (local) Verified against GetTreeState(112):
  Wallet Ironwood Root:  0ccbfbd545b379f9cf6f1a762f9ffb89459957e2af0015be958deaaf451d023d
  Remote ironwoodTree:   010a972047a8ab8776bb376e3135da5a2977dac561a1a7ebd2d0d17b77c836c12c001f01c7aede353ca76cc34fd173b9b87264b831db6fbc3f2c8271a134b93625789231019297a05de6ad2b28ac4df7df9188ee841c21dfd94c9afcea00c64e62fce72435013e0fb883fa871d7a71ea4e83667cb7d4588054955c8ebfce36deba9936254b2b00011291417a11e7be287beeb2e43e1f4544884e7b4cdf8871b44a2fa478de649a0801a772cfc93e2f2cafaa37863ca4a3d43ccff881c77cf5a35f8d209dc64c06991c00000000000000000000000000000000000000000000000000
  Derived Remote Root:   0ccbfbd545b379f9cf6f1a762f9ffb89459957e2af0015be958deaaf451d023d
[send] (http://127.0.0.1:39067) (local) Anchor verification is single-source. No secondary verification endpoints configured.

✅ Funded successfully via LIGHTWALLETD stack!
Recipient: uregtest1zchcl4t6stdjf23589hkrr3pmsslk36t8arszjz79vhj3p2gqpedfgztltegzj9phkqn6h5xdyg6n7xg9p08mg26q6932d4rhty9mnj6gzuzgsjst63m447gdzxynypht3lc5pzh5l5kj37dfscug9e2c7mn882v9wwruhxuww3u2kzvd4y8wkpckwtkkru7ympc4q2r3yqu7rlpdg4
Amount:    5.0 ZEC (500000000 zatoshis)
Txid:      f82252b1f01a3aa8a04214850b492e77e6a66c7c4a6af1b58292b6afca8efff7
```

Mine 1 block to confirm the funding transaction:

```bash
npx zcash-dev mine 1
```

Output:

```text
Mining 1 block(s) on LIGHTWALLETD regtest stack...
✅ Successfully mined 1 block(s) on Zebra.
```

---

## Step 5: Check Your Account Balance

Query your account balance across the Sapling, Orchard, and Ironwood shielded pools:

```bash
npx zcash-dev balance
```

Output:

```text
Querying balance on regtest via 127.0.0.1:39067...

--- Account Balance ---
Network:     regtest
Total:       5.00000000 ZEC (500000000 zatoshis)
Ironwood:    5.00000000 ZEC
Orchard:     0.00000000 ZEC
Sapling:     0.00000000 ZEC
Transparent: 0.00000000 ZEC
Confirmed:   5.00000000 ZEC
Pending:     0.00000000 ZEC
```

---

## Step 6: Test Your First Payment (Dry Run & Broadcast)

Before spending funds or broadcasting to the network, perform a safe dry run to compute the ZIP-317 proportional fee:

```bash
npx zcash-dev send --to uregtest1zchcl4t6stdjf23589hkrr3pmsslk36t8arszjz79vhj3p2gqpedfgztltegzj9phkqn6h5xdyg6n7xg9p08mg26q6932d4rhty9mnj6gzuzgsjst63m447gdzxynypht3lc5pzh5l5kj37dfscug9e2c7mn882v9wwruhxuww3u2kzvd4y8wkpckwtkkru7ympc4q2r3yqu7rlpdg4 --amount 0.1 --memo "Coffee payment"
```

Output:

```text
=== Transaction Dry Run ===
Network:   regtest
Recipient: uregtest1zchcl4t6stdjf23589hkrr3pmsslk36t8arszjz79vhj3p2gqpedfgztltegzj9phkqn6h5xdyg6n7xg9p08mg26q6932d4rhty9mnj6gzuzgsjst63m447gdzxynypht3lc5pzh5l5kj37dfscug9e2c7mn882v9wwruhxuww3u2kzvd4y8wkpckwtkkru7ympc4q2r3yqu7rlpdg4
Amount:    0.1 ZEC (10000000 zatoshis)
Fee:       0.00010000 ZEC (10000 zatoshis) [estimated (ZIP-317, 2 outputs assumed)]
Endpoint:  127.0.0.1:39067
Memo:      Coffee payment
Status:    DRY RUN ONLY — transaction was NOT broadcast.
Pass --yes to sign and broadcast this transaction.
```

To sign and broadcast the payment across the regtest network, pass the `--yes` flag:

```bash
npx zcash-dev send --to uregtest1zchcl4t6stdjf23589hkrr3pmsslk36t8arszjz79vhj3p2gqpedfgztltegzj9phkqn6h5xdyg6n7xg9p08mg26q6932d4rhty9mnj6gzuzgsjst63m447gdzxynypht3lc5pzh5l5kj37dfscug9e2c7mn882v9wwruhxuww3u2kzvd4y8wkpckwtkkru7ympc4q2r3yqu7rlpdg4 --amount 0.1 --memo "Coffee payment" --yes
```

Output:

```text
[Sync] (http://127.0.0.1:39067) (local) Starting sync from height 2 to target 113 (tip: 113, batch size: 1000, throttle: 50ms)...
[Sync] (http://127.0.0.1:39067) (local) Height: 113/113 (100.0%) | Req: 3 | Speed: 1349.4 blocks/s
[Sync] (http://127.0.0.1:39067) (local) Verified against GetTreeState(113):
  Wallet Ironwood Root:  6c13b5f4c9ce7ec0e315e8d9fe733dda53961f4b20ff6cf3d2e4be62a8397d13
  Remote ironwoodTree:   012751e889833988f826f5c33efe974ce990a1207e9300671e02a4dbc7f2fb793f001f01b39d0eca9e8cbd5e346eb6cd290197266c7073c00a538e6d079116660e63d70a000001f2bd509ac1f0fffc746aa05024e177d73595db66ac0e1f245400877dabb02531011291417a11e7be287beeb2e43e1f4544884e7b4cdf8871b44a2fa478de649a0801a772cfc93e2f2cafaa37863ca4a3d43ccff881c77cf5a35f8d209dc64c06991c00000000000000000000000000000000000000000000000000
  Derived Remote Root:   6c13b5f4c9ce7ec0e315e8d9fe733dda53961f4b20ff6cf3d2e4be62a8397d13
[send] (http://127.0.0.1:39067) (local) Anchor verification is single-source. No secondary verification endpoints configured.

✅ Transaction broadcast successfully!
Txid:      3825ae0cd01997c3719a5f73b1def34797d452b4133c2997e9f65f3bb7b6a7a5
Fee:       0.00010000 ZEC (10000 zatoshis)
```

Confirm the transaction and check balance:

```bash
npx zcash-dev mine 1
npx zcash-dev balance
```

Output:

```text
--- Account Balance ---
Network:     regtest
Total:       4.99990000 ZEC (499990000 zatoshis)
Ironwood:    4.99990000 ZEC
Orchard:     0.00000000 ZEC
Sapling:     0.00000000 ZEC
Transparent: 0.00000000 ZEC
Confirmed:   4.99990000 ZEC
Pending:     0.00000000 ZEC
```

---

## Step 7: Run Your Web Application

Start the local Next.js development server for your scaffolded application:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Step 8: Open the Developer Dashboard

In a separate terminal, launch the Developer Dashboard to inspect real-time balances across pools, view diversified Unified Addresses, and monitor node sync:

```bash
pnpm dashboard
```

Open [http://localhost:3050](http://localhost:3050) in your browser.

> [!NOTE]
> **Scaffolded App (Port 3000) vs. Developer Dashboard (Port 3050)**:
> - **Scaffolded Web App (Port 3000)**: This is your end-user Next.js application (`app/page.tsx` and `app/api/account/route.ts`). It connects directly to your configured Zcash network/indexer to display your account's Unified Address, balance, and account API data.
> - **Developer Dashboard (Port 3050)**: An interactive visual diagnostic cockpit with multi-pool breakdowns (Transparent, Sapling, Orchard, Ironwood), node health telemetry, diversifier generation, and raw transaction decryption. Running `pnpm dashboard` launches the dashboard bundled with `zcash-dev`.
>
> You can also inspect node health, total chain supply, mempool, or block states directly from the CLI:
> ```bash
> npx zcash-dev info
> npx zcash-dev balance
> npx zcash-dev supply
> npx zcash-dev block tip
> ```
> For complete port bindings and configuration details, see the [Default Ports & Configuration Reference](./reference/ports.md).

