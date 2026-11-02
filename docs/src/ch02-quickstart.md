# Chapter 2: Quickstart

In this quickstart, you will scaffold a new shielded Zcash application, initialize an isolated local NU7 regtest devnet, fund an account, run the application, and simulate your first shielded payment.

## Prerequisites

- **Node.js**: v20 or v22 LTS
- **pnpm**: v9 or v11 (or npm / yarn)
- **Docker & Docker Compose**: Required for running the local Zebra + lightwalletd devnet

---

## Step 1: Scaffold Your Application

Run the scaffolder CLI to generate a new application. You can provide flags directly or walk through the interactive wizard:

```bash
npx create-zcash-app my-shielded-app --network regtest --regtest-stack nu7 --key-source generate
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
Unified Address:  uregtest142daw7l8csg2m3sl3dykhl0k0xe498vh5zffp80f28xxjjxdt2jfx2gee06h9lj90tg5e9xjymn6lk3h94pz4kz653au7z9yala8jc5hjxph6trp3sf9303y62eg58lz43hdkanw00jmvykuzd9rc0044k2a3ppcm24t3nlhy8hnnv5fxnnpf9ck4uegy5zzy2wr45z4eu0w6upke4c
Transparent:      tmXezXncSzSsTNvLqxtwwfjEzDXWXQWmpFZ
```

---

## Step 3: Launch Local Regtest Devnet (`--stack nu7`)

To test locally without spending real or testnet funds, launch the isolated NU7 regtest environment (powered by Zebra 7.0.0 and lightwalletd):

```bash
npx zcash-dev regtest up --stack nu7
```

This command:
1. Configures `zebra.toml` with the miner address from Account 0.
2. Starts the Zebra and lightwalletd Docker containers.
3. Automatically mines 105 initial blocks to satisfy coinbase maturity requirements (coinbase outputs require 100 confirmations to spend).

---

## Step 4: Mine Blocks & Fund Accounts

To advance the blockchain or simulate confirmations, use the `mine` command:

```bash
npx zcash-dev mine 10
```

To fund any Unified Address on the devnet, execute:

```bash
npx zcash-dev fund uregtest142daw7l8csg2m3sl3dykhl0k0xe498vh5zffp80f28xxjjxdt2jfx2gee06h9lj90tg5e9xjymn6lk3h94pz4kz653au7z9yala8jc5hjxph6trp3sf9303y62eg58lz43hdkanw00jmvykuzd9rc0044k2a3ppcm24t3nlhy8hnnv5fxnnpf9ck4uegy5zzy2wr45z4eu0w6upke4c 5.0
```

---

## Step 5: Check Your Account Balance

Query your account balance across the Sapling, Orchard, and Ironwood shielded pools:

```bash
npx zcash-dev balance
```

Example output:

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
npx zcash-dev send --to uregtest142daw7l8csg2m3sl3dykhl0k0xe498vh5zffp80f28xxjjxdt2jfx2gee06h9lj90tg5e9xjymn6lk3h94pz4kz653au7z9yala8jc5hjxph6trp3sf9303y62eg58lz43hdkanw00jmvykuzd9rc0044k2a3ppcm24t3nlhy8hnnv5fxnnpf9ck4uegy5zzy2wr45z4eu0w6upke4c --amount 0.1 --memo "Coffee payment"
```

Output:

```text
=== Transaction Dry Run ===
Network:   regtest
Recipient: uregtest142daw7l8csg2m3sl3dykhl0k0xe498vh5zffp80f28xxjjxdt2jfx2gee06h9lj90tg5e9xjymn6lk3h94pz4kz653au7z9yala8jc5hjxph6trp3sf9303y62eg58lz43hdkanw00jmvykuzd9rc0044k2a3ppcm24t3nlhy8hnnv5fxnnpf9ck4uegy5zzy2wr45z4eu0w6upke4c
Amount:    0.1 ZEC (10000000 zatoshis)
Fee:       0.00010000 ZEC (10000 zatoshis) [estimated (ZIP-317, 2 outputs assumed)]
Endpoint:  127.0.0.1:39067
Memo:      Coffee payment
Status:    DRY RUN ONLY — transaction was NOT broadcast.
Pass --yes to sign and broadcast this transaction.
```

To sign and broadcast the payment across the regtest network, pass the `--yes` flag:

```bash
npx zcash-dev send --to uregtest142daw7l8csg2m3sl3dykhl0k0xe498vh5zffp80f28xxjjxdt2jfx2gee06h9lj90tg5e9xjymn6lk3h94pz4kz653au7z9yala8jc5hjxph6trp3sf9303y62eg58lz43hdkanw00jmvykuzd9rc0044k2a3ppcm24t3nlhy8hnnv5fxnnpf9ck4uegy5zzy2wr45z4eu0w6upke4c --amount 0.1 --memo "Coffee payment" --yes
```

---

## Step 7: Run Your Web Application

Start the local Next.js development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The application dashboard displays your live balance, recent shielded transactions, and network synchronization status.

