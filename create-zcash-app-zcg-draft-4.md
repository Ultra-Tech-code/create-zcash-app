# create-zcash-app: A Scaffolder and TypeScript SDK for Building Shielded Zcash Apps

**Draft shared for community feedback ahead of a formal ZCG submission.** It follows the official ZCG grant application format so the community can review the real thing. Feedback and criticism are very welcome.

---

## Application Owners

Dre ([@drekal0](https://github.com/drekal0) / `dre2809`) — *[co-applicant to be confirmed]*

## Organization Name

Zcash Builders Africa (an initiative led by members of the Web3 Lagos / Zcash Africa developer community) — *[working name, editable]*

## How did you learn about Zcash Community Grants

Through the Zcash community and ZecHub, and by following ZCG's published RFPs and wishlist on the forum and zcashcommunitygrants.org.

## Requested Grant Amount (USD)

$30,000

## Category

Infrastructure (developer tooling) — also maps to the Core wishlist item "Developer documentation."

---

## Project Lead

**Name:** Dre — *[full legal name for KYC to be supplied privately if required]*
**Role:** Project lead and lead engineer (SDK, scaffolder, templates, documentation)
**Background:** Developer and community builder active in the Zcash ecosystem, focused on lowering the barrier to entry for new Zcash developers across Africa. Runs a production Zcash stack (zebrad + lightwalletd + a custom Orchard scanner as a systemd service). Built ZTippy, a production Telegram tipping bot with a Rust native addon for Orchard trial-decryption (a starting point for this project's broader Rust crypto core). Building Zeclocals, a peer-to-peer shielded trading platform (Next.js 14, FROST 2-of-3 escrow), and Zredict, a privacy-focused prediction market (Rust/Axum). Maintains builders-zcash (dre2809.github.io/builders-zcash), a Docusaurus-based Zcash developer portal modeled on Avalanche's, which is the onboarding front door this tooling plugs into. Regularly produces technical Zcash content and runs developer workshops.
**Responsibilities:** Architecture, SDK and addon engineering, template development, the `create-zcash-app` CLI, documentation, developer workshops, and upstream contributions.

## Additional Team Members

*[Optional co-lead — community/DevRel and workshop delivery. To be confirmed.]*

---

## Project Summary

An open-source scaffolder (`npx create-zcash-app`) and TypeScript SDK that lets a web developer go from nothing to a working shielded-payment application against a local Zcash chain in minutes. It sits **on top of** the Zcash Foundation's Z3 devnet rather than reimplementing node orchestration, and hides shielded-note trial-decryption — across both the Orchard and the new Ironwood pools — behind a clean TypeScript API so building on Zcash no longer requires Rust or raw gRPC. And because it collapses time-to-first-app from days to minutes, it is as much training infrastructure as developer tooling: the backbone for onboarding new developers hands-on in workshops, dev sprints, and bootcamps, not just a convenience for people already building.

## Project Description

Getting a developer from "curious about Zcash" to "my app just detected a shielded payment" is still a multi-day slog: sync a node, wire up lightwalletd, understand Unified Addresses and the shielded pools (Orchard — sealed by the July 2026 Ironwood upgrade but still holding a large balance that drains out only gradually — and the new Ironwood pool), hand-roll viewing-key deposit detection across both, and glue it all together across Rust and gRPC. Most web and app developers bounce off before they ship anything.

The node layer of this problem is already being solved. The Zcash Foundation's **Z3** brings up Zebra, Zaino and Zallet together via Docker Compose on mainnet, testnet, or a local regtest network that starts in seconds, and it explicitly targets developers building against it. Z3 is the chain, and `create-zcash-app` never reimplements it. The thin developer-harness layer just above the node — a regtest faucet, deterministic Unified Address fixtures, and a golden end-to-end CI recipe — has no actively maintained home today (an earlier effort has gone stale against the current post-Ironwood stack), so `create-zcash-app` provides those pieces itself as light glue on Z3 rather than depending on an unmaintained tool.

What none of these provide is the **application layer**: a scaffolded, runnable starter app and a developer-friendly SDK on top of the running chain. `create-zcash-app` fills exactly that gap. It generates a working app wired to a Z3 regtest chain, ships deterministic key fixtures and a small `zcash-dev` helper CLI, and provides a TypeScript SDK that wraps the lightwalletd/Zaino gRPC interface with a Rust/WASM addon handling trial-decryption for both the Orchard and Ironwood pools underneath. The result: a web developer runs one command, gets a real shielded-payments app, funds an address locally, and watches the deposit land in the UI — all deterministic, all offline.

## Proposed Problem

Zcash has a developer-onboarding bottleneck. The protocol is powerful but the first-run experience for building an app is steep, Rust-centric, and under-documented for the JavaScript/TypeScript ecosystem where most application developers live. This is a direct adoption constraint: fewer builders means fewer Zapps, fewer integrations, and slower ecosystem growth. It aligns with the ZCG wishlist items "Developer documentation" (Core) and "Application on top of Zcash network" / "Integrating native ZEC in end user apps" (Zapps).

## Proposed Solution

Ship and maintain `create-zcash-app` — an interactive scaffolder — plus a TypeScript SDK and a set of runnable templates. The flagship is a **full-stack Next.js app** (React frontend and server-side backend in one repo — the shape most application developers reach for); the other templates are reductions of it: a **backend/service** template, a **browser-only wallet-lite** (client-side SDK via WASM), and a **scanner service**. Each template comes pre-wired to a local Z3 regtest chain with deterministic fixtures, so a new developer is productive in minutes instead of days. Publish the documentation and runnable tutorials inside the existing builders-zcash developer portal — the tool is what sits behind the portal's front door — and pair it with community workshops, so the thing we build is also the thing we teach with. The portal supplies discovery and distribution; the scaffolder supplies the runnable payoff each tutorial ends in. The same one-command flow that helps a solo developer is what makes the tool a training instrument: a facilitator can take a room of developers from zero to a working shielded-payments app in a single session, so `create-zcash-app` becomes the standard on-ramp for the workshops, dev sprints, and bootcamps that onboard new Zcash builders across the region — turning developer education from a slide deck into a hands-on build.

## Solution Format

Open-source software (MIT). All repositories are public and include a `CONTRIBUTING.md` following Zcash development standards, and documentation and tutorials are published as a section of the existing builders-zcash portal (Docusaurus v3) rather than a competing standalone site. The complete deliverable inventory is enumerated in the Deliverables section toward the end of this document.

## Dependencies

- **Z3** (Zcash Foundation) — consumed as the local regtest/testnet node stack (Zebra + Zaino + Zallet). Our generated compose attaches to it through Z3's documented, versioned service contract (`z3-contract.yaml`), so we build against a stable interface and never reimplement the node. We override one default: Z3's Zaino pin (see below). Bugs and doc gaps found are reported upstream (one filed already — see Upstream Merge Opportunities).
- **Zebra, lightwalletd, Zaino, Zallet** — the underlying node and indexer software. Ironwood/NU6.3 serve support over the lightwalletd-compatible gRPC interface was verified end-to-end on Z3 regtest across deposit detection *and* spend-proving prerequisites, with one correction to our own earlier assumption: Z3's **default** Zaino pin (0.6.0) serves Ironwood deposit data correctly but rejects `GetSubtreeRoots` for the Ironwood pool (needed for witness construction / spend-proving). This is fixed in Zaino ≥ 0.10.0. Templates pin `Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0` (or newer) rather than Z3's default.
- **librustzcash** (NU6.3 crate cohort: `orchard` 0.15, `zcash_primitives` 0.29, `zcash_keys` 0.15, `zcash_address` 0.13, `zcash_protocol` 0.10) — for the Rust crypto core (trial-decryption, key derivation, note selection, and proving), covering both the Orchard and Ironwood pools and the v6 transaction format. Exact patch versions pinned from the current release at build time.

## Technical Approach

The core is a TypeScript SDK exposing a small, stable surface (generate/import Unified Addresses, check balance by pool, build and broadcast a shielded send, detect incoming notes via a viewing key). Under the hood it speaks the lightwalletd/Zaino gRPC interface and delegates trial-decryption to a Rust addon compiled to a native Node module (with a WASM build for the browser). Keys, the native addon, and the gRPC calls all run **server-side** by default — a browser cannot safely hold spending or viewing keys, run the native module, or make raw gRPC calls — so in the full-stack template the SDK lives in the server layer (Next.js server actions / API routes) and the React frontend calls it; the WASM build serves the separate browser-only wallet case that has no backend. Because the Ironwood pool (activated on mainnet at height 3,428,143 on July 28, 2026) reuses Orchard's Action structure and Halo2 proof system — the NU6.3 circuit updates landed in the `orchard` crate itself — a single addon covers both pools, differing only in the note commitment tree, nullifier set, and the v6 transaction format. Both pools hold material balances during the ongoing, voluntary Orchard-to-Ironwood migration — Orchard drains only through a one-way turnstile, at the pace holders choose (live tracker: ironwood.zodl.com) — so the SDK reads both by design. The same both-pool, v6-aware addon can also construct ZIP-318 migration transactions (v6 transactions that move value from Orchard into Ironwood), letting apps help users migrate funds during the transition window. `create-zcash-app` is a `create-next-app`–style scaffolder, not a Foundry/Hardhat-style toolchain — Zcash has no contracts to compile or deploy, and Z3 owns the local chain. It scaffolds a chosen template and generates a compose file that attaches to Z3 through its published service contract for the local chain. The `zcash-dev` CLI (`mine`, `fund`, `send`, `reset`) is a thin convenience wrapper over Z3's existing regtest tooling — Z3 already mines blocks on demand (`generate`) and funds through Zallet — so we ship developer ergonomics, not a second node harness; deterministic UA/key fixtures are written into `.env`. The scaffolder supports three network tiers — regtest as the default (instant and deterministic, right for the onboarding loop and CI), testnet for staging against public infrastructure (funded by **ztap**, our self-hostable, self-mining, Ironwood-capable faucet — teams run their own instance, so a workshop never depends on a public faucet's uptime), and mainnet for production — so a developer follows the same regtest → testnet → mainnet path a real app ships along. Templates target the zebra + zaino stack (zcashd reached end-of-life on July 18, 2026 and is not a target), with a lightwalletd path retained where Zaino is not yet ready. The builders-zcash portal's code samples are the templates themselves, run in CI against a Z3 regtest chain on every change, so the documentation cannot silently rot as the stack migrates — a chronic failure mode for developer portals. Everything is reproducible from public repos.

## Upstream Merge Opportunities

- **Z3 / Zebra (regtest):** real-world developer use surfaces and reports rough edges (for example, coinbase spendability and value-pool response handling), with fixes or reproductions offered upstream.
- **Zaino:** real-world integration testing across the 0.6.0–0.10.0 range surfaced a genuine version-floor requirement for Ironwood spend-proving support (`GetSubtreeRoots`), not visible from release notes alone — continuing to surface and report wallet-scanning edge cases against regtest fixtures as development proceeds.
- **Z3:** filed a documentation gap — the README's Indexer section warns about Zebra-version compatibility with the pinned Zaino, but not about the Zaino-version floor needed for full Ironwood serve support. Offered to open the README PR directly.
- **Ecosystem SDKs:** the TypeScript surface and Rust crypto core are offered upstream where useful. No forced forks are planned.

---

## Budget

### Hardware/Software Costs (USD)

$1,500

**Justification:** Domains, an npm organization, code-signing/CI minutes, and test devices to validate the scaffolder on real hardware and OS variants. All software used is open source; docs hosting is free via GitHub Pages.

### Service Costs (USD)

$3,500

**Justification:** A small hosted demo regtest/testnet endpoint so the docs and workshops have a zero-install "try it" path (~$1,200); developer workshop delivery and materials for the Zcash Africa community (~$1,500); and contingency for CI, bandwidth, or additional tooling (~$800).

### Compensation Costs (USD)

$25,000

**Justification:** Roughly six months of focused engineering and DevRel work for the lead, at a modest below-market rate: SDK and addon development, the scaffolder and five app templates, the facilitator workshop lab, documentation, delivered workshops, and upstream contributions.

*Why $30,000 for six months?* The figure reflects scope, not calendar time, and the shape of the ask is unusually favorable to the ecosystem. Hard costs are minimal (~$5,000) because the tool runs on a developer's laptop, not on servers — so ~$25,000 compensates a single lead delivering a TypeScript SDK, a Rust crypto core (trial-decryption, key derivation, note selection, and proving) spanning the Orchard and Ironwood pools, five runnable templates, a facilitator-ready workshop lab, CI, documentation, and workshops actually delivered to new developers. That is below-market for the scope. Crucially, unlike server or light-client-infrastructure grants, it carries **no ongoing hosting liability** once the grant ends: the deliverable is a maintained library and a training program, not a service someone must keep paying to run. ZCG funds a durable developer on-ramp once, rather than signing up for a recurring bill.

### Total Budget (USD)

$30,000

### Previous Funding

No prior ZCG grant.

### Other Funding Sources

None. Phase 1 (below) is self-funded as proof of execution.

---

## Risk Assessment

### Implementation Risks

- **Regtest / Z3 maturity.** Regtest has had sharp edges (e.g. coinbase spendability). Mitigation: we consume Z3 rather than owning the node layer, report bugs upstream, and retain a testnet fallback mode so onboarding never hard-depends on a single regtest quirk.
- **Stack still settling post-Ironwood.** The ecosystem is mid-migration from lightwalletd toward Zaino. We verified this directly rather than taking upstream release notes at face value: Zaino's Ironwood serve support landed incrementally across 0.6.0–0.10.0, not all at once. Z3's default pin (0.6.0) correctly serves Ironwood deposit detection (`GetBlockRange`, `GetTreeState`) but rejects `GetSubtreeRoots` for Ironwood outright — a gap that would have silently blocked spend-proving had we not tested it end-to-end. The fix is confirmed present in Zaino 0.10.0. Mitigation: pin Zaino ≥ 0.10.0 (overriding Z3's default), keep a lightwalletd path where useful for Orchard/Sapling-only cases, and continue verifying each Zaino bump against a regtest fixture in CI rather than trusting version-string claims alone.
- **Scope creep.** The temptation is to rebuild node orchestration. Mitigation: strict scope discipline — we own only the app + SDK layer; Z3 owns the node.
- **Adoption.** The main risk for any tool. Mitigation: built-in distribution through the builders-zcash portal (an existing, already-live discovery surface the lead maintains), the lead's developer community and workshops, plus dogfooding the SDK in real apps (Zeclocals, Zredict). The front door exists before the tool ships, which directly answers "will anyone find this?"

### Potential Side Effects

- **Perceived overlap with Z3.** Mitigation: explicitly complementary — this is the application layer on top of Z3's node layer, contributing bug reports and fixes upstream rather than reimplementing anything.

### Success Metrics

- **Time-to-first-shielded-tx:** measured and published — from `npx create-zcash-app` to a detected shielded payment on a fresh machine (target: single-digit minutes).
- At least four runnable templates shipped and maintained.
- Measurable uptake: npm downloads, GitHub stars/forks, and at least one real third-party app built on the SDK.
- New developers onboarded hands-on via the workshop lab, tracked per session (headcount and completion rate) — the tool's primary training outcome.
- Upstream bug reports or PRs accepted.

---

## Project Schedule

### Startup Funding (USD)

$6,000

**Justification:** Covers Milestone 1, most of which is delivered and self-funded as proof of execution before the committee commits further funds — mirroring the strongest recent infrastructure applications. The lead's existing production work (ZTippy's Rust Orchard addon — to be extended to Ironwood — and Zeclocals' deposit detection) is the foundation the SDK is extracted from, so this is packaging and extending proven code, not new R&D.

### Milestone Details

**Milestone 1 — Proof of execution: SDK MVP + flagship template (self-funded, delivered at submission)**
Amount: $6,000
Expected completion: at submission / ~2 weeks after approval
User stories:
- "As a web developer, I want one command to get a working full-stack shielded-payments app — UI plus a server-side SDK — against a local chain, so that I can start building immediately."
Deliverables:
- TypeScript SDK MVP (UA generation, balance by pool, shielded send, viewing-key deposit detection across the Orchard and Ironwood pools) with the Rust crypto core (trial-decryption, key derivation, note selection, and proving)
- Zaino ≥ 0.10.0 (Ironwood-capable, including spend-proving prerequisites — see Dependencies) stood up as the indexer the SDK reads through, overriding Z3's default pin; verified against a Z3 regtest chain; lightwalletd retained where useful for Orchard/Sapling-only cases
- The flagship full-stack Next.js template (React frontend + server-side SDK) wired to a Z3 regtest chain, with deterministic fixtures and the `zcash-dev` CLI (which doubles as the regtest faucet)
- `create-zcash-app` CLI skeleton and a short screencast: zero to detected shielded payment
Acceptance criteria: A community member reproduces the demo on a fresh machine; the SDK reads through Zaino ≥ 0.10.0 and detects an Ironwood-capable shielded deposit against Z3 regtest.

**Milestone 2 — Facilitator-ready workshop lab + ztap core (~month 1)**
Amount: $5,000
Expected completion: ~month 1
User stories:
- "As a workshop facilitator, I want a ready-to-run lab that takes a room of developers from zero to a working shielded-payments app in one session, so I can onboard them hands-on."
Deliverables:
- A guided workshop lab built on the flagship template — a facilitator-ready, hands-on "zero to detected shielded payment" walkthrough with checkpoints, designed to run in a dev sprint, workshop, or bootcamp session, and published as a track in the builders-zcash portal
- First runnable tutorial, and the `create-zcash-app` interactive prompts polished for classroom use
- ztap self-mining core: a self-hostable testnet node that mines its own TAZ and exposes a basic drip (shares the SDK's crypto core; browser proof-of-work and rate limiting follow in M3)
Acceptance criteria: The lab is dry-run end-to-end with a participant completing it in one session and a facilitator confirms it is classroom-ready; the ztap core self-hosts in one command and mines its own TAZ.

**Milestone 3 — Reduction templates, app-layer surface, ztap PoW + CI (~month 2)**
Amount: $5,000
Expected completion: ~month 2
Deliverables:
- Two additional templates (backend/service and scanner-service — both reductions of the flagship)
- App-layer SDK surface that Z3 has no concept of: ZIP-321 payment-request generation and parsing, React hooks and components (e.g. `useShieldedDeposit`, a `<PayWithZec>` component), and framework adapters (Next.js server actions, an Express/Fastify middleware)
- ztap browser proof-of-work and per-address rate limiting, layered on the M2 self-mining core
- A golden end-to-end CI recipe for scaffolded apps, built on Z3 regtest (ours, since no maintained harness exists)
Acceptance criteria: Templates reproducible against Z3, CI green on a fresh clone, at least one external developer scaffolds an app; ztap gates a drip behind browser PoW and enforces a per-address rate limit.

**Milestone 4 — Testnet staging + migration, wired end-to-end (~month 3)**
Amount: $5,000
Expected completion: ~month 3
Deliverables:
- Testnet staging mode in the scaffolder, with `zcash-dev faucet` pointing at a ztap instance by default — completing the regtest → testnet → mainnet path
- ZIP-318 Orchard-to-Ironwood migration support in the SDK (constructing a v6 migration transaction), letting apps help users move funds during the transition window
- End-to-end integration tying the network layer together: a scaffolded app staged on testnet, funded by ztap, detecting an Ironwood deposit through Zaino
Acceptance criteria: A scaffolded app runs on testnet with TAZ dripped from a ztap instance and detects an Ironwood-capable shielded note; a ZIP-318 migration is constructed and detected on regtest.

**Milestone 5 — Workshops delivered + documentation (~month 4)**
Amount: $5,000
Expected completion: ~month 4
Deliverables:
- The workshop lab delivered in at least two dev sprints or workshops with the Zcash Africa developer community
- Complete tutorials and SDK API reference published as a builders-zcash portal section
- Tool and lab iterated on the basis of workshop feedback
Acceptance criteria: At least two sessions delivered, participant completion recorded, and docs validated by an external developer.

**Milestone 6 — Browser path, hardening, and sustainability (~month 5–6)**
Amount: $4,000
Expected completion: ~month 5–6
Deliverables:
- WASM/browser path for the SDK plus the browser-only wallet-lite template (optionally a point-of-sale template)
- Hardening pass across the templates and SDK
- Long-term maintenance and sustainability plan
- Final project report and handover materials
Acceptance criteria: Browser-only template reproducible, published time-to-first-shielded-tx metric, and ZCG accepts the final report.

## Deliverables

All deliverables are open-source (MIT) in public repositories:

- **`create-zcash-app`** — an interactive scaffolder, published as an npm package.
- **TypeScript SDK** — server-side by default with a WASM browser build; covers Unified Address generation, balance by pool, shielded send, and viewing-key deposit detection across the Orchard and Ironwood pools.
- **Rust crypto core** (trial-decryption, key derivation, note selection, and proving) — a native Node module plus a WASM build, v6-aware, spanning both the Orchard and Ironwood pools.
- **ZIP-318 migration support** — SDK support for constructing Orchard-to-Ironwood migration transactions, so apps can help users move funds during the transition window.
- **App-layer payment primitives** — ZIP-321 payment-request generation and parsing, plus a watch-address-and-callback helper for shielded deposits (the pattern Z3 has no concept of).
- **React hooks and components** — `useShieldedDeposit` and a `<PayWithZec>` component for drop-in shielded payments.
- **Framework adapters** — Next.js server actions and an Express/Fastify middleware so the SDK drops into common stacks.
- **App-developer testing utilities** — deterministic fixtures and vitest/jest helpers for writing tests against a Z3 regtest chain.
- **Zaino integration** — targeting Zaino ≥ 0.10.0 (Ironwood-capable, including spend-proving prerequisites), overriding Z3's default pin, over the lightwalletd-compatible gRPC, with a lightwalletd path retained where useful and Ironwood deposit detection and spend-proving both verified against regtest fixtures.
- **`zcash-dev` CLI + fixtures** — a thin convenience wrapper over Z3's regtest tooling (`mine`, `fund`, `send`, `reset`), plus deterministic Unified Address / key fixtures.
- **ztap** — a self-hostable, self-mining, Ironwood-capable Zcash testnet faucet (MIT) with browser proof-of-work: one command to stand up, mines its own TAZ (no reserve or custodian to maintain), and drips shielded to a Unified Address. Shipped as software teams run themselves for workshops, not a service we operate. Shares the SDK's crypto core.
- **Testnet staging** — a testnet mode in the scaffolder and a `zcash-dev faucet` helper that points at a ztap instance by default.
- **Application templates (four or more)** — the flagship full-stack Next.js app, a backend/service template, a scanner-service template, and a browser-only wallet-lite (with an optional point-of-sale template).
- **Facilitator-ready workshop lab** — a hands-on "zero to detected shielded payment" walkthrough with checkpoints, runnable in a dev sprint, workshop, or bootcamp, published as a track in the builders-zcash portal.
- **Golden end-to-end CI recipe** — built on Z3 regtest, keeping scaffolded apps and the portal's code samples green as the stack moves.
- **Documentation, tutorials, and SDK API reference** — published as a section of the builders-zcash developer portal.
- **Workshops delivered** — at least two dev sprints or workshops run with the Zcash Africa developer community using the lab.
- **Screencast** — a short "zero to detected shielded payment" demo.
- **Sustainability plan and final report** — a long-term maintenance plan plus final project report and handover materials.
- **Upstream contributions** — bug reports and fixes offered to Z3 / Zebra / Zaino where real-world use surfaces them.

## Supporting Documents

- Existing work demonstrating capability: ZTippy (Rust Orchard trial-decryption addon — the starting point for this project's Rust crypto core), Zeclocals (`dre2809/zeclocals`), Zredict (`github.com/drekal0/Zredict`)
- builders-zcash developer portal (the onboarding front door and distribution surface this tooling plugs into): https://dre2809.github.io/builders-zcash
- Z3 (dependency): https://github.com/ZcashFoundation/z3
- *[Phase 1 repo, status page, and screencast links to be added at submission]*

---

*cc @ZcashGrants for early guidance. Feedback and criticism welcome before the formal submission.*
