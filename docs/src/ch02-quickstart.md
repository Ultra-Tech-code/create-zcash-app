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
Unified Address:  uregtest1u2l7u92cra0gxezjx5wawvygsts77wxjwnuudm5g75le33ejrmkycncltrqcr4k3yd9sfzs47t0p4d0u4jllf7lwt83k2k7jzuwx7m2knglnky6lm96f07wch0hus4ynrg8vdzevwpmg8xupmhz00k6w6nxx6qrsvsx9u042aj9wsn4wsvg5l993kjjq456cmpenkjz8srjdkrx2mpy
Transparent:      tmT96bXJukAhyno6uG71aAsAD4qPjqp9DA3
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

Verify running containers:

```bash
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
```

Output:

```text
zcash-regtest-nu7-lightwalletd-1 electriccoinco/lightwalletd 127.0.0.1:39067->9067/tcp, 127.0.0.1:39068->9068/tcp
zcash-regtest-nu7-zebra-1 zfnd/zebra:7.0.0 127.0.0.1:38080->8080/tcp, 127.0.0.1:39232->18232/tcp
```

---

## Step 4: Mine Blocks & Fund Accounts

To fund any Unified Address on the devnet from the miner account, execute:

```bash
npx zcash-dev fund uregtest1u2l7u92cra0gxezjx5wawvygsts77wxjwnuudm5g75le33ejrmkycncltrqcr4k3yd9sfzs47t0p4d0u4jllf7lwt83k2k7jzuwx7m2knglnky6lm96f07wch0hus4ynrg8vdzevwpmg8xupmhz00k6w6nxx6qrsvsx9u042aj9wsn4wsvg5l993kjjq456cmpenkjz8srjdkrx2mpy 5.0
```

Output:

```text
[Sync] (http://127.0.0.1:39067) (local) Starting sync from height 2 to target 105 (tip: 105, batch size: 1000, throttle: 50ms)...
[Sync] (http://127.0.0.1:39067) (local) Height: 105/105 (100.0%) | Req: 106 | Speed: 92.8 blocks/s
[Sync] (http://127.0.0.1:39067) (local) Verified against GetTreeState(105):
  Wallet Ironwood Root:  fc49cc9d82fe07368882d114a351ba8a43958dd46510146c2a9ec8f9bc7c9633
  Remote ironwoodTree:   01938725621c955d324b6ffe9b7ced282b9b5dd11f8e08cbbcce7bb91475e3da3201be2703abf46ca358c9cc09dbba50f116172a8678f51ca1076c0fbb2053cc20221f01d2bf3a0ac32264340e454d392b4912ef2d9eff6d30a22a25e22102cf6e375a13019244bce713f91beff73211846f11a5a75ad0098f9432c61d84d67cff514ea70c00000175ed1d5065fc9a855044e440f906e66ed240fd53bb2d1cfa9d04c939bc45150d01f9fbaa9f049a7243b66bf87599c9ea477278c1a2c7f94c5ff3eb5ede64f7412500000000000000000000000000000000000000000000000000
  Derived Remote Root:   fc49cc9d82fe07368882d114a351ba8a43958dd46510146c2a9ec8f9bc7c9633
[send] (http://127.0.0.1:39067) (local) Anchor verification is single-source. No secondary verification endpoints configured.

✅ Funded successfully via NU7 stack!
Recipient: uregtest1u2l7u92cra0gxezjx5wawvygsts77wxjwnuudm5g75le33ejrmkycncltrqcr4k3yd9sfzs47t0p4d0u4jllf7lwt83k2k7jzuwx7m2knglnky6lm96f07wch0hus4ynrg8vdzevwpmg8xupmhz00k6w6nxx6qrsvsx9u042aj9wsn4wsvg5l993kjjq456cmpenkjz8srjdkrx2mpy
Amount:    5.0 ZEC (500000000 zatoshis)
Txid:      0d50c1f1eba9d290a61e343941c6c46014fba0e07028410ba7bf02a408b9baaa
```

Mine 1 block to confirm the funding transaction:

```bash
npx zcash-dev mine 1
```

Output:

```text
Mining 1 block(s) on NU7 regtest stack...
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
npx zcash-dev send --to uregtest1u2l7u92cra0gxezjx5wawvygsts77wxjwnuudm5g75le33ejrmkycncltrqcr4k3yd9sfzs47t0p4d0u4jllf7lwt83k2k7jzuwx7m2knglnky6lm96f07wch0hus4ynrg8vdzevwpmg8xupmhz00k6w6nxx6qrsvsx9u042aj9wsn4wsvg5l993kjjq456cmpenkjz8srjdkrx2mpy --amount 0.1 --memo "Coffee payment"
```

Output:

```text
=== Transaction Dry Run ===
Network:   regtest
Recipient: uregtest1u2l7u92cra0gxezjx5wawvygsts77wxjwnuudm5g75le33ejrmkycncltrqcr4k3yd9sfzs47t0p4d0u4jllf7lwt83k2k7jzuwx7m2knglnky6lm96f07wch0hus4ynrg8vdzevwpmg8xupmhz00k6w6nxx6qrsvsx9u042aj9wsn4wsvg5l993kjjq456cmpenkjz8srjdkrx2mpy
Amount:    0.1 ZEC (10000000 zatoshis)
Fee:       0.00010000 ZEC (10000 zatoshis) [estimated (ZIP-317, 2 outputs assumed)]
Endpoint:  127.0.0.1:39067
Memo:      Coffee payment
Status:    DRY RUN ONLY — transaction was NOT broadcast.
Pass --yes to sign and broadcast this transaction.
```

To sign and broadcast the payment across the regtest network, pass the `--yes` flag:

```bash
npx zcash-dev send --to uregtest1u2l7u92cra0gxezjx5wawvygsts77wxjwnuudm5g75le33ejrmkycncltrqcr4k3yd9sfzs47t0p4d0u4jllf7lwt83k2k7jzuwx7m2knglnky6lm96f07wch0hus4ynrg8vdzevwpmg8xupmhz00k6w6nxx6qrsvsx9u042aj9wsn4wsvg5l993kjjq456cmpenkjz8srjdkrx2mpy --amount 0.1 --memo "Coffee payment" --yes
```

Output:

```text
[Sync] (http://127.0.0.1:39067) (local) Starting sync from height 2 to target 106 (tip: 106, batch size: 1000, throttle: 50ms)...
[Sync] (http://127.0.0.1:39067) (local) Height: 106/106 (100.0%) | Req: 3 | Speed: 1381.6 blocks/s
[Sync] (http://127.0.0.1:39067) (local) Verified against GetTreeState(106):
  Wallet Ironwood Root:  bc85897b39e8f1b36972efa5cd19b750f330a9394c85e0f469f42c3584d65a29
  Remote ironwoodTree:   01ceb285bddfc22645c2778f5d954ed554b6a92b022e452f23aeac0aee4337d60a015cf20fa3344759410b147d82cd6f128fa5f8209ca745990346016b65d764cd1e1f014a4f9dff47be4aa401d412315cc88775da0365b3c66fa91aa2e5a106a0da412800014182a315a2325d1514fa9f451f8b542e288edcbfd68be6f8f9579a6d7c4b630a000175ed1d5065fc9a855044e440f906e66ed240fd53bb2d1cfa9d04c939bc45150d01f9fbaa9f049a7243b66bf87599c9ea477278c1a2c7f94c5ff3eb5ede64f7412500000000000000000000000000000000000000000000000000
  Derived Remote Root:   bc85897b39e8f1b36972efa5cd19b750f330a9394c85e0f469f42c3584d65a29
[send] (http://127.0.0.1:39067) (local) Anchor verification is single-source. No secondary verification endpoints configured.

✅ Transaction broadcast successfully!
Txid:      cf0bd7f9d05ff5003cfdc258c4936823dab1005854cc14b2ed9b629323e5efba
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

Start the local Next.js development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The application dashboard displays your live balance, recent shielded transactions, and network synchronization status.

