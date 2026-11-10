# Default Ports & Network Configuration

This reference documents all default network ports used across the `create-zcash-app` ecosystem, including the scaffolded end-user application, the developer diagnostic dashboard, and the three local Docker Compose regtest devnet tiers.

---

## 1. Quick Reference Table

| Port | Service / Application | Protocol | Default Host Binding | Context / Scope | Config Variable / Override |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`3000`** | **Scaffolded Next.js App** | HTTP | `127.0.0.1:3000` | Scaffolded projects | `PORT=3000` / `next dev -p 3000` |
| **`3050`** | **Developer Dashboard** | HTTP | `127.0.0.1:3050` | Scaffolded projects & Monorepo | `PORT=3050` / `pnpm dashboard` / `zcash-dev dashboard -p 3050` |
| **`39232`** | **Zebra JSON-RPC (Regtest)** | HTTP JSON-RPC | `127.0.0.1:39232` | All 3 regtest tiers | `ZEBRA_RPC_PORT` / `ZCASH_ZEBRA_RPC` |
| **`38080`** | **Zebra Health Check** | HTTP | `127.0.0.1:38080` | All 3 regtest tiers | `ZEBRA_HEALTH_PORT` |
| **`39067`** | **Lightwalletd gRPC** | gRPC / HTTP/2 | `127.0.0.1:39067` | Tier 1 (Lightwalletd) & Tier 3 (Full) | `LIGHTWALLETD_GRPC_PORT` / `ZCASH_ENDPOINT` |
| **`39068`** | **Lightwalletd HTTP** | HTTP | `127.0.0.1:39068` | Tier 1 (Lightwalletd) & Tier 3 (Full) | `LIGHTWALLETD_HTTP_PORT` |
| **`38137`** | **Zaino Indexer gRPC** | gRPC / HTTP/2 | `127.0.0.1:38137` | Tier 2 (Zaino, Experimental) | `ZAINO_GRPC_PORT` / `ZCASH_ENDPOINT` |
| **`8182`** | **Zallet Wallet RPC** | HTTP JSON-RPC | `127.0.0.1:8182` | Tier 3 (Full Stack) | `ZALLET_RPC_PORT` |
| **`8230`** | **Zebra Indexer Port** | Internal RPC | `127.0.0.1:8230` | Tier 3 (Full Stack, Zallet sync) | `ZEBRA_INDEXER_PORT` |
| **`39167`** | **Local Testnet Lightwalletd** | gRPC / HTTP/2 | `127.0.0.1:39167` | Local testnet stack | `zcash-dev testnet lightwalletd --port` |
| **`39168`** | **Local Testnet Lightwalletd HTTP**| HTTP | `127.0.0.1:39168` | Local testnet stack | `zcash-dev testnet lightwalletd --http-port` |
| **`18232`** | **Local Testnet Zebra RPC** | HTTP JSON-RPC | `127.0.0.1:18232` | Local testnet stack | `zebrad.toml` / cookie auth |

> [!IMPORTANT]
> **Single Active Regtest Stack Rule**:
> Only **one** regtest stack can run at a time on a machine because all three tiers share host port **`39232`** for Zebra JSON-RPC (as well as `38080` for healthchecks and `39067` for lightwalletd on Tiers 1 and 3). Before starting a different tier, tear down the running stack with `zcash-dev regtest down` or `docker compose down`.

---

## 2. Web Applications: Scaffolded App vs. Developer Dashboard

### Scaffolded Application (Port 3000)
- **What it is**: Your standalone production Next.js application generated with `npx create-zcash-app`.
- **Location**: Generated in your project directory (`app/page.tsx`, `app/api/account/route.ts`).
- **Default Port**: `3000` (Next.js standard).
- **When to use**: During day-to-day development of your own decentralized application, payment flow, or user interface.
- **How to launch**:
  ```bash
  cd <your-project>
  pnpm dev
  ```
- **How to change the port**:
  - In `package.json`:
    ```json
    "scripts": {
      "dev": "next dev -p 3001"
    }
    ```
  - Via environment variable: `PORT=3001 pnpm dev`
  - Via command-line argument: `pnpm dev -- -p 3001`

### Developer Dashboard (Port 3050)
- **What it is**: An internal diagnostic cockpit and health monitor maintained in `@zcash-app/dashboard`. It provides multi-pool balance breakdown (Transparent, Sapling, Orchard, Ironwood), live block synchronization percentage tracking, diversified Unified Address generation, and transaction inspection.
- **Location & Installation**: Available both in standalone scaffolded projects via `pnpm dashboard` (bundled with `zcash-dev`) and inside a full clone of the `create-zcash-app` source repository.
- **Default Port**: `3050` (to avoid collision with the scaffolded app on 3000).
- **When to use**: When developing applications, inspecting live sync progress, testing diversifiers, or diagnosing node and indexer states.
- **How to launch**:
  - In a scaffolded application:
    ```bash
    pnpm dashboard
    # or: npx zcash-dev dashboard
    ```
  - From the monorepo clone:
    ```bash
    git clone https://github.com/Ultra-Tech-code/create-zcash-app.git
    cd create-zcash-app
    pnpm install && pnpm build
    pnpm --filter @zcash-app/dashboard run dev
    ```
- **How to change the port**:
  - Via CLI option:
    ```bash
    zcash-dev dashboard --port 3055
    ```

---

## 3. Three-Tier Regtest Devnet Stacks

### Tier 1: Lightwalletd (Default)

The Lightwalletd stack (`--stack lightwalletd`, default) runs a standalone Zebra 7.0.0 node coupled directly to a Lightwalletd indexer. NU7 activates at block 2 by default.

- **Zebra JSON-RPC**: `127.0.0.1:39232` (HTTP JSON-RPC 2.0, mining via `zcash-dev mine`)
- **Zebra Health**: `127.0.0.1:38080` (HTTP healthcheck)
- **Lightwalletd gRPC**: `127.0.0.1:39067` (gRPC `CompactTxStreamer`)
- **Lightwalletd HTTP**: `127.0.0.1:39068` (HTTP metrics/health)

### Tier 2: Zaino (Experimental)

The Zaino stack (`--stack zaino`, experimental) builds Zaino `feat/nu7` from source (pin `aaf8122a703704e05147d984f08ff82c789860ad`, Rust 1.96.0) and runs it against Zebra 7.0.0. Initial build takes ~3+ minutes.

- **Zebra JSON-RPC**: `127.0.0.1:39232`
- **Zebra Health**: `127.0.0.1:38080`
- **Zaino gRPC**: `127.0.0.1:38137` (gRPC `CompactTxStreamer`)

### Tier 3: Full Stack (Zallet + Lightwalletd)

The Full stack (`--stack full`) runs Zebra 7.0.0 in indexer mode, Zallet `v0.1.0-beta.4`, and Lightwalletd together against the same state.

- **Zebra JSON-RPC**: `127.0.0.1:39232`
- **Zebra Indexer**: `127.0.0.1:8230` (used internally by Zallet)
- **Zebra Health**: `127.0.0.1:38080`
- **Zallet RPC**: `127.0.0.1:8182` (direct JSON-RPC to Zallet daemon)
- **Lightwalletd gRPC**: `127.0.0.1:39067`
- **Lightwalletd HTTP**: `127.0.0.1:39068`

---

## 4. Port Conflict Resolution & Troubleshooting

If you encounter `EADDRINUSE` errors when starting services:

1. **Check for conflicting processes**:
   ```bash
   lsof -i :3000  # Check for running scaffolded app
   lsof -i :3050  # Check for running Developer Dashboard
   lsof -i :39067 # Check for running lightwalletd
   lsof -i :39232 # Check for running Zebra
   lsof -i :38137 # Check for running Zaino
   lsof -i :8182  # Check for running Zallet
   ```

2. **Stop orphan docker containers**:
   ```bash
   docker compose down --remove-orphans
   # Or tear down the dev stack:
   npx zcash-dev regtest down
   # Or wipe regtest containers and volumes:
   npx zcash-dev regtest wipe --yes
   ```

3. **Verify port isolation**:
   Within any single stack, services bind to distinct non-overlapping host ports. Testnet-local ports (`39167`, `39168`) do not collide with regtest ports.
