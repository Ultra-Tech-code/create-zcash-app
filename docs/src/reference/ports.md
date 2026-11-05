# Default Ports & Network Configuration

This reference documents all default network ports used across the `create-zcash-app` ecosystem, including the scaffolded end-user application, the developer diagnostic dashboard, and the local Docker Compose devnet stacks.

---

## 1. Quick Reference Table

| Port | Service / Application | Protocol | Default Host Binding | Context / Scope | Config Variable / Override |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`3000`** | **Scaffolded Next.js App** | HTTP | `127.0.0.1:3000` | Scaffolded projects | `PORT=3000` / `next dev -p 3000` |
| **`3050`** | **Developer Dashboard** | HTTP | `127.0.0.1:3050` | Scaffolded projects & Monorepo | `PORT=3050` / `pnpm dashboard` / `zcash-dev dashboard -p 3050` |
| **`39067`** | **Lightwalletd gRPC (NU7)** | gRPC / HTTP/2 | `127.0.0.1:39067` | NU7 regtest stack | `LIGHTWALLETD_GRPC_PORT` / `ZCASH_ENDPOINT` |
| **`39232`** | **Zebra JSON-RPC (NU7)** | HTTP JSON-RPC | `127.0.0.1:39232` | NU7 regtest stack | `ZEBRA_RPC_PORT` / `ZCASH_ZEBRA_RPC` |
| **`38080`** | **Zebra Health Check (NU7)** | HTTP | `127.0.0.1:38080` | NU7 regtest stack | `ZEBRA_HEALTH_PORT` |
| **`39068`** | **Lightwalletd HTTP (NU7)** | HTTP | `127.0.0.1:39068` | NU7 regtest stack | `LIGHTWALLETD_HTTP_PORT` |
| **`28137`** | **Zaino Indexer gRPC (Z3)** | gRPC / HTTP/2 | `127.0.0.1:28137` | Z3 legacy stack | `docker-compose.yml` / `ZCASH_ENDPOINT` |
| **`8181`** | **RPC Router (Zallet+Zebra)** | HTTP JSON-RPC | `127.0.0.1:8181` | Z3 legacy stack | `docker-compose.yml` / `LISTEN_PORT` |
| **`29232`** | **Zebra JSON-RPC (Z3)** | HTTP JSON-RPC | `127.0.0.1:29232` | Z3 legacy stack | `docker-compose.yml` / `zebra.toml` |
| **`39167`** | **Local Testnet Lightwalletd** | gRPC / HTTP/2 | `127.0.0.1:39167` | Local testnet stack | `zcash-dev testnet lightwalletd --port` |
| **`18232`** | **Local Testnet Zebra RPC** | HTTP JSON-RPC | `127.0.0.1:18232` | Local testnet stack | `zebrad.toml` / cookie auth |

---

## 2. Web Applications: Scaffolded App vs. Developer Dashboard

A common source of confusion is the distinction between your scaffolded web application and the repository's internal Developer Dashboard:

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
  - Via environment variable:
    ```bash
    PORT=3001 pnpm dev
    ```
  - Via command-line argument:
    ```bash
    pnpm dev -- -p 3001
    ```

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
    # Or with zcash-dev CLI:
    # pnpm --filter zcash-dev exec zcash-dev dashboard --port 3050
    ```
- **How to change the port**:
  - In `packages/dashboard/package.json` (monorepo):
    ```json
    "scripts": {
      "dev": "next dev -p 3055 --webpack"
    }
    ```
  - Via CLI option:
    ```bash
    zcash-dev dashboard --port 3055
    ```

---

## 3. Local Regtest Devnet Stacks

### NU7 Devnet Stack (Default)

The NU7 stack (`--regtest-stack nu7`) runs a standalone Zebra 7.0.0 node coupled directly to a Lightwalletd indexer.

#### 1. Lightwalletd gRPC Server (`39067`)
- **Protocol**: gRPC (`CompactTxStreamer`)
- **Purpose**: Used by `@zcash-app/sdk` (`createClient`) and `zcash-dev` to fetch compact blocks, query tree states, and broadcast transactions.
- **How to change**:
  1. In `docker/regtest-nu7/docker-compose.yml` (or your project's `docker-compose.yml`), adjust the host port mapping:
     ```yaml
     ports:
       - "127.0.0.1:39077:9067"
     ```
  2. Set `LIGHTWALLETD_GRPC_PORT=39077` in your environment or compose `.env`.
  3. Update `ZCASH_ENDPOINT=127.0.0.1:39077` in your application's `.env.local` or pass `--endpoint 127.0.0.1:39077` to CLI commands.

#### 2. Zebra JSON-RPC Server (`39232`)
- **Protocol**: HTTP JSON-RPC 2.0 (no auth required on local regtest)
- **Purpose**: Used by `zcash-dev mine`, `zcash-dev info`, `zcash-dev rpc`, `zcash-dev block`, and `zcash-dev supply` to trigger block generation and inspect node state.
- **How to change**:
  1. In `docker/regtest-nu7/docker-compose.yml`, adjust the host port mapping:
     ```yaml
     ports:
       - "127.0.0.1:39242:18232"
     ```
  2. Set `ZEBRA_RPC_PORT=39242` in your environment or compose `.env`.
  3. Update `ZCASH_ZEBRA_RPC=http://127.0.0.1:39242` in `.env.local` or pass `--zebra-rpc http://127.0.0.1:39242` to CLI commands.

#### 3. Auxiliary NU7 Ports
- **`38080`** (`ZEBRA_HEALTH_PORT`): Zebra HTTP healthcheck server (`http://127.0.0.1:38080/`).
- **`39068`** (`LIGHTWALLETD_HTTP_PORT`): Lightwalletd HTTP healthcheck and metrics endpoint (`http://127.0.0.1:39068/`).

---

### Z3 Legacy Devnet Stack

The Z3 stack (`--regtest-stack z3`) runs a Zebra 7.0.0 node, Zaino indexer, and Zallet wallet daemon with an RPC router.

#### 1. Zaino gRPC Indexer (`28137`)
- **Protocol**: gRPC (`CompactTxStreamer`)
- **Purpose**: Indexer endpoint for Z3 applications.
- **How to change**: In `docker/regtest/docker-compose.yml`, edit the `zaino` service port mapping `127.0.0.1:28137:8137` and update `ZCASH_ENDPOINT` in `.env.local`.

#### 2. RPC Router (`8181`)
- **Protocol**: HTTP JSON-RPC 2.0
- **Purpose**: Proxies JSON-RPC calls to both Zebra (`18232`) and Zallet (`28232`), enabling `z_sendmany` faucet funding.
- **How to change**: In `docker/regtest/docker-compose.yml`, edit the `rpc-router` port mapping `127.0.0.1:8181:8181` and the `LISTEN_PORT` environment variable.

#### 3. Zebra JSON-RPC (`29232`)
- **Protocol**: HTTP JSON-RPC 2.0
- **Purpose**: Direct JSON-RPC access to Zebra on the Z3 stack.
- **How to change**: In `docker/regtest/docker-compose.yml`, edit the `zebra` service port mapping `127.0.0.1:29232:18232`.

---

## 4. Port Conflict Resolution & Troubleshooting

If you encounter `EADDRINUSE` errors when starting services:

1. **Check for conflicting processes**:
   ```bash
   lsof -i :3000  # Check for running scaffolded app
   lsof -i :3050  # Check for running Developer Dashboard
   lsof -i :39067 # Check for running lightwalletd
   lsof -i :39232 # Check for running Zebra
   ```

2. **Stop orphan docker containers**:
   ```bash
   docker compose down --remove-orphans
   # Or wipe regtest containers and volumes:
   npx zcash-dev regtest wipe --yes
   ```

3. **Verify port isolation**:
   Every local stack and service in the repository is automated to bind to distinct, non-overlapping ports so that the NU7 stack, Z3 stack, and web applications can coexist without collision.

