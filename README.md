# LayerZero on Stellar: OFT & USDT0 demos

Nine small, heavily explained demos that teach how **LayerZero V2** works on **Stellar**, using **USDT0** (Tether's USDT delivered over LayerZero's OFT standard, live on Stellar mainnet since 2 September 2026) as the real-world example. Built for developers meeting cross-chain on Stellar for the first time and for hackathon teams who want something to fork.

Every page has the same shape: a **"What's happening here?"** explainer with a diagram, the **live demo**, and an **"Under the hood"** panel showing the exact code the page just ran (extracted from this repo's source at build time, not pseudocode).

![Inspector](docs/screenshots/inspector.png)

## Ground truth: mainnet vs testnet

> **USDT0 does not exist on Stellar testnet.** It is mainnet-only. Any asset called "USDT0" on testnet is someone's mock.
> The **LayerZero endpoint is live on testnet** (EID 40600), so cross-chain messaging and custom test OFTs work there.
> This repository is an independent developer demo. It is not affiliated with, or endorsed by, Tether, Everdawn Labs or LayerZero Labs.

The site therefore splits into two modes, shown by a persistent badge on every page:

| Mode | Pages | What happens |
|---|---|---|
| **MAINNET · READ-ONLY** | Inspector, Tracker, Quotes, Dashboard | Reads the real USDT0 and real bridge messages via Horizon, Soroban RPC (`simulateTransaction`), the LayerZero registry and the LayerZero Scan API. Never writes, never asks you to sign. |
| **TESTNET** | Playground, Postcards, Launchpad, Compose | A clearly-labelled **mock** `tUSDT0`, a test OFT, a postcard OApp and a composer vault wired through the live testnet endpoint to Arbitrum Sepolia. Freighter and MetaMask sign real testnet transactions. |

## The demos

| # | Page | Teaches |
|---|---|---|
| 1 | **What is an OFT?** | Burn-and-mint vs lock-and-mint (Stellar is `MintBurn`, Ethereum is an adapter), shared decimals and dust (interactive 7 → 6 decimal calculator), the endpoint / ULN / DVN / executor message path (animated), the three-contract shape of USDT0 on Stellar, and a quiz. |
| 2 | **USDT0 Inspector** | Horizon asset + issuer facts (flags, locked master key, no `home_domain`), SAC and OFT config via read-only simulation, wired peers for every USDT0 network, the ULN DVN set that actually protects the pathway, and the Ethereum adapter on the other end. |
| 3 | **Bridge Message Tracker** | The LayerZero message lifecycle from the Scan API: source tx → per-DVN attestations → commit → execution, with decoded packet header and OFT payload, status glossary, live polling. Reused by every other page. |
| 4 | **Fee & Quote Explorer** | `quote_oft` and `quote_send` on-chain (no API key), the two fees and their units, a five-chain comparison chart, and the Transfer API as a bring-your-own-key panel. |
| 5 | **Testnet OFT Playground** | Fund with Friendbot, trustline + faucet mint of the mock **tUSDT0** (a testnet copy of USDT0's setup: locked issuer, SAC-manager admin, `MintBurn` OFT), the wiring (`set_peer`, enforced options, `set_config` DVN override), then send it Stellar → Sepolia (Freighter) and back (MetaMask), tracking each message to delivery, with every XDR/calldata logged. |
| 6 | **Cross-Chain Postcards** | Raw LayerZero messaging with no tokens: a 140-byte postcard from Stellar lands in a Sepolia contract (and back), rendered on a wall with pixel-art stamps from the message GUID. |
| 7 | **Omnichain Dashboard** | Live ticker of USDT0 messages in/out of Stellar, wired-peer graph, current supply and a derived 7-day trajectory, linking to the Dune dashboard for the long view. |
| 8 | **Launch your own omnichain token** | A guided, wallet-signed launch on testnet: throwaway issuer → SAC → SAC-manager → trustline + mint → hand off admin → OFT (MintBurn or LockUnlock) → MINTER_ROLE → lock issuer → Sepolia OFT with MetaMask → peers, enforced options, DVN config on both sides → bridge it. Progress persists in the browser. |
| 9 | **Compose: MetaMask drives a Soroban vault** | A Stellar application for users who only hold an EVM wallet. `OFT.send` from MetaMask on Arbitrum Sepolia names a Soroban vault as the recipient and carries a `composeMsg`; on Stellar the OFT mints to the vault and queues a compose, and `lz_compose` (executor or anyone) credits the sender's EVM address. Withdrawals to any G or C address are authorized by a MetaMask `personal_sign` signature that the contract verifies with `secp256k1_recover`; a Friendbot-funded throwaway key pays the Stellar fee. |

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Static SPA (Vite + React + TS + Tailwind)"]
    UI[Pages] --> LIB[src/lib: stellar / evm / layerzero]
    LIB --> WAL[WalletProvider: Stellar Wallets Kit · MetaMask (EIP-6963/viem) · Phantom]
  end
  LIB -->|GET| REG[LayerZero registry\nmetadata.layerzero-api.com]
  LIB -->|GET| SCAN[LayerZero Scan API\nscan(-testnet).layerzero-api.com]
  LIB -->|GET| HZ[Horizon]
  LIB -->|simulateTransaction / sendTransaction| RPC[Soroban RPC\nmainnet: 3 public RPCs with failover · testnet]
  LIB -->|eth_call| EVMRPC[publicnode EVM RPCs]
  LIB -.->|optional, your key| TAPI[Transfer API]
  subgraph Scripts["scripts/ (Node, tsx)"]
    BW[build-wasm.sh] --> WASM[contracts/wasm/*.wasm]
    CE[compile-evm.ts] --> ART[contracts/evm/artifacts]
    DT[deploy-testnet.ts] --> DEP[src/config/testnet-deployment.json]
  end
  WASM --> DT
  ART --> DT
  DEP --> UI
```

No backend and no secrets in the bundle. All data sources are CORS-open (verified 2026-09-10). Every fetch degrades to a cached copy or a bundled snapshot with a visible "live data unavailable" notice instead of a white screen.

**The registry is the source of truth.** `src/lib/layerzero/chains.ts` fetches `metadata.layerzero-api.com/v1/metadata/deployments` at runtime (cached 15 min) and falls back to `src/config/registry.snapshot.json`, which `pnpm verify:registry` refreshes at build time and diffs against the documented addresses in `src/config/layerzero.fallback.ts`. The home page and the testnet pages show a "registry check" panel.

## Run locally

Prerequisites: Node 24, pnpm 11.

```bash
pnpm install
pnpm dev                 # http://localhost:5173
pnpm verify:registry     # refresh the registry snapshot and report address drift
pnpm test                # vitest: codecs against real on-chain byte vectors
pnpm typecheck && pnpm lint && pnpm build
pnpm smoke               # headless Chrome: every route, console errors, screenshots to docs/screenshots
```

The mainnet pages work immediately. The testnet pages read `src/config/testnet-deployment.json`; this repo ships with the Stellar half deployed (below).

## Deploy the testnet OFT

You need a wallet for each side: **Freighter** (or any Stellar Wallets Kit wallet) on Stellar **Test Net**, and **MetaMask** on **Sepolia**. The scripts need Stellar testnet keys (generated and Friendbot-funded automatically) and an EVM deployer key with about 0.02 Sepolia ETH.

```bash
cp .env.example .env               # keys are generated on first run if left empty
pnpm build:wasm                    # Rust 1.90.0 + wasm32v1-none: builds oft, sac_manager, postcard_oapp, faucet, composer_vault (artifacts are committed, so you can skip this)
pnpm compile:evm                   # solc-js: TestOFT.sol + PostcardOApp.sol (artifacts are committed too)
pnpm deploy:testnet --stellar      # asset → SAC → SAC-manager → set_admin → OFT(MintBurn) → Faucet → MINTER_ROLE → lock issuer → PostcardOApp → ComposerVault
pnpm deploy:testnet --evm          # TestOFT + PostcardOApp on Arbitrum Sepolia (EVM_TESTNET=sepolia for the old pathway), setPeer(40600), setEnforcedOptions (msg types 1 and 2); then wires Stellar → EVM:
                                   #   set_peer, set_enforced_options, endpoint.set_config (send + receive ULN naming the active DVN)
pnpm e2e:testnet                   # script-signed proof: faucet drip → tUSDT0 Stellar → Sepolia + a postcard, tracked to DELIVERED
pnpm e2e:testnet --reverse         # Arbitrum Sepolia → Stellar
pnpm e2e:compose                   # MetaMask-style round trip with the EVM key: deposit + compose into the vault, then a personal_sign withdrawal
pnpm e2e:testnet --postcard        # only a postcard Stellar → Arbitrum Sepolia
pnpm e2e:testnet --track <tx>      # follow an existing message without sending
pnpm exec tsx --tsconfig tsconfig.node.json scripts/e2e-launchpad.ts CODE LockUnlock   # replay the Launchpad flow with script keys, end to end
pnpm exec tsx --tsconfig tsconfig.node.json scripts/execute-sepolia.ts <stellar tx>   # deliver a verified message yourself
```

`deploy-testnet.ts` is idempotent (progress in `scripts/.state/`), pulls the endpoint, ULN and DVN from the registry, and refuses to run if the registry's Stellar testnet EID is not 40600. Commit the updated `src/config/testnet-deployment.json` so the site picks it up.

### Current deployment (Stellar testnet EID 40600 ↔ Arbitrum Sepolia EID 40231)

| Piece | Address |
|---|---|
| Mock asset | `tUSDT0:GB3QCH2JLGYMYNCTVC45LSKGMCRQOEVF46IUQAEWW67JOMHW63ZMAFEJ` (issuer locked, flags revocable + clawback) |
| SAC | `CCM64LC7ZB426DRO7MNDDQYL3ATYPIISRJX6B7SUTTEJCCZF2BXN2XLT` |
| SAC-manager (SAC admin) | `CBDTSASNBUEAUBJVZL5TCSWNL7GMJ63MFFGJZNPVFAJMHHLELZ73BGM2` |
| OFT (`MintBurn`) | `CB4M3EC45CYVUYHRUY6T3UYBCM3E5JVA7SQF5OTIQY2IR3KHL3RT42GE` |
| Faucet (1,000 tUSDT0 per drip, ~1 h cooldown) | `CBFDW3L2CG7RUANKFSLGIOREVMXLW52EKLARBSIVGVP424LMNRNHLPUS` |
| PostcardOApp (Stellar) | `CCGXQ2GUT4K5C4FZGIB3X4H6ZFUSFR32E3SR36T7CFVGCSSS24RTINWQ` |
| ComposerVault (Stellar) | `CD2LRGWZT7DJ4CMYDA56VKTWYYBUFE3G6OVXAMOSTLAYMA6UN3BDE4RV` |
| TestOFT (Arbitrum Sepolia, 6 decimals, with `faucet()`) | `0x3ae0ed1dffacc319af52a8fe3fa93638d70e6e8e` |
| PostcardOApp (Arbitrum Sepolia) | `0xf06c1948d85e7539c6e4b424d620831581c908be` |

The Arbitrum Sepolia addresses equal the earlier Sepolia ones because the same deployer key started from nonce 0 on both chains. The Sepolia contracts (EID 40161) remain deployed and peered but the site no longer uses them.

Shared: endpoint `CALTBA5S…`, ULN `CCMLPCAW…`, DVN `CB7EWGPR…` (LayerZero Labs); Arbitrum Sepolia endpoint `0x6EDCE654…`; the OApps carry per-OApp send and receive ULN configs naming the active DVN, enforced options of 200k gas towards Arbitrum Sepolia and 500k towards Stellar (message types 1 and 2 on the EVM OFT, so composed sends work).

The mock mirrors USDT0's admin model on purpose: issuer locked, SAC admin = SAC-manager, new supply only under `MINTER_ROLE` (held by the OFT and by the Faucet, so no key is ever needed in the browser). The EVM TestOFT also has a `faucet()` (1,000 tUSDT0 per hour) so the Compose page works with MetaMask alone; like the Stellar Faucet it mints out of thin air, so the mock's two supplies are independent. To see the other OFT mode, `LockUnlock` (a token whose home chain is Stellar: the OFT holds the reserve and the other chain mints), launch one on the Launchpad page.

## Live site

https://kaankacar.github.io/stellar-layerzero-demos/ (GitHub Pages, built by `.github/workflows/pages.yml` on every push to `main`). Deep links return the SPA through `404.html`, so the HTTP status is 404 while the page renders normally.

## Known caveats

- **Testnet redeploy risk.** The Stellar testnet endpoint was redeployed in August 2026. Every testnet address in the original brief for this project was stale: endpoint `CBQOTWFU…` is now `CALTBA5S…`, ULN `CAWCTJDD…` is now `CCMLPCAW…`, executor `CD26IUC2…` is now `CCAVZ7ES…`, and so on (`BRIEF_STALE_TESTNET` in `src/config/layerzero.fallback.ts` keeps the old generation). At one point two contracts claimed EID 40600 and only one was in the registry. Always resolve addresses from the registry; the Playground's health check compares the deployed OFT's `endpoint()` with the registry before letting you send.
- **One usable testnet DVN, and a stale default.** Testnet has two active DVN operators in the registry (LayerZero Labs and Paxos, 29 September 2026); the deploy script names the first, LayerZero Labs. The ULN's *default* send/receive configs for the EVM testnets still name a **deprecated** DVN, so an out-of-the-box OApp `send` fails with `#1213 UnsupportedMessageLib` (after `quote` succeeds). The deploy script sets a per-OApp ULN config (`config_type` 2 and 3) requiring the active DVN.
- **Registry key quirk.** The `deployments` endpoint keys Stellar as `stellar-mainnet` / `stellar-testnet`; the `metadata` endpoint uses `stellar`. Inner `chainKey` values (what Scan uses) are `stellar` and `stellar-testnet`. `chains.ts` handles both.
- **Transfer API needs a key.** `POST /v1/quotes` returns 401 without an `x-api-key` (early access via LayerZero's form). Page 4 quotes on-chain instead and offers the API as bring-your-own-key. Its `/tokens?chainKey=` filter is ignored server-side, so we filter client-side.
- **DVN count.** The registry lists **seven** active DVN operators on Stellar mainnet (LayerZero Labs, Horizen, Nethermind, Canary, USDT0's own DVN, Paxos and Canary Sponsored, as of 29 September 2026). USDT0's pathway config requires **three** (LayerZero Labs, Canary, USDT0) with 320 Stellar confirmations. The Inspector reads this live rather than hardcoding a number.
- **Burn/mint is per leg.** Stellar's OFT is `MintBurn`; Ethereum's is an OFT *Adapter* that locks canonical USDT (`approvalRequired = true`). Never promise burn-and-mint on both ends of a route.
- **Public RPC limits.** Public Soroban RPCs keep about 7 days of events and rate-limit bursts (some 429s carry no CORS headers, which browsers report as CORS errors). The app caps concurrency at 4 in-flight calls and fails over across three mainnet RPCs.
- **Scan API windows.** `/messages/latest` is newest-first and paginated with `nextToken`; the Dashboard's 7-day view walks a handful of pages.
- **Scan indexes Stellar-testnet messages by GUID first.** For minutes after a send, `/messages/tx/<stellar hash>` returns 404 while `/messages/guid/<guid>` already shows the message with an empty source tx. The tracker reads the GUID from the endpoint's `packet_sent` event via RPC and falls back to the GUID lookup.
- **Sepolia → Stellar testnet is stuck at the DVN; Arbitrum Sepolia is not.** Messages *into* Stellar testnet from Sepolia (EID 40161) have sat at "Ready for DVNs to verify" since 9 September 2026 (other developers' messages too), while the same LayerZero Labs DVN attests Arbitrum Sepolia (EID 40231) → Stellar testnet within seconds. Nobody but the configured DVN can produce that attestation, so on 29 September the EVM side moved to Arbitrum Sepolia. Once a DVN attestation exists, delivery on Stellar is permissionless as well (`ULN302.commit_verification` + the OApp's `lz_receive` with *you* as the executor): the Tracker offers it and `scripts/execute-stellar.ts <evm tx>` does it from the CLI.
- **Testnet delivery is slow and you can finish it yourself.** On the Stellar-testnet → EVM pathway the DVN attested within minutes but the executor took 8 to 90 minutes on recent messages. Execution is permissionless: after the DVN attests, `ReceiveUln302.commitVerification` + `EndpointV2.lzReceive` deliver the message. The Tracker shows a "deliver it yourself" button for testnet messages (MetaMask), and `scripts/execute-sepolia.ts <stellar tx>` does the same from the CLI. The first tUSDT0 transfer in this repo was delivered that way.
- **Composed messages: the executor may not follow through, so finish it yourself.** A deposit on the Compose page is one OFT `send` with a `composeMsg`. On Stellar the OFT credits the vault in `lz_receive`, then queues the compose on the endpoint (`compose_queue` holds its hash, `compose_sent` event holds the payload). The Stellar executor is expected to call `lz_compose` next; on 29 September 2026 it had not committed the first Arbitrum Sepolia message 16 minutes after the DVN attested, and the compose was still queued 20 minutes after we delivered it ourselves. Both steps are permissionless: `scripts/execute-stellar.ts <evm tx>` commits and runs `lz_receive`, and the Compose page (or `pnpm e2e:compose --track <evm tx>`) reads the `compose_sent` payload from the delivery transaction and calls `lz_compose` with your key as the executor. The vault deliberately does not require the executor's auth; the endpoint's `clear_compose` is what proves the payload is genuine. Note that `#[contractevent]` names are snake_case on the wire (`compose_sent`, `packet_sent`).
- **Attribution.** USDT0 is built and operated by **Everdawn Labs**; USDT is Tether's asset.
- **Solana.** Phantom is supported in the wallet bar and for Tracker lookups only. No Solana Postcards leg: there is no verified Stellar-testnet ↔ Solana pathway, and a Solana OApp is an Anchor program (see CONTRIBUTING for the extension idea).
- **HyperCore** is listed by USDT0 but has no EID in the registry; it appears as "no EID" in the peers table.
- **An OApp must combine enforced options itself.** The OFT does it inside `quote_send`/`send`; a bare OApp built on the skeleton does not. Our first PostcardOApp passed the caller's (empty) options straight to the endpoint and ULN302 rejected them with error `#1114`; the fix is `Self::combine_options(env, dst_eid, msg_type, options)` before `__quote` / `__lz_send` (see `contracts/stellar/postcard-oapp/src/lib.rs`). Found by the end-to-end script, not by the compiler.

## Project layout

```
src/
  config/        networks, USDT0 addresses, documented LayerZero fallbacks, registry snapshot, testnet deployment
  lib/layerzero/ registry client, Scan client, options type-3 / packet header / OFT payload codecs, tracker hook, Transfer API
  lib/stellar/   RPC failover, ScVal helpers, read-only simulation, signed tx path, Horizon, OFT / ULN / endpoint / SAC wrappers
  lib/evm/       viem clients, OFT + PostcardOApp ABIs
  lib/wallets/   WalletProvider (Stellar Wallets Kit, EIP-6963/MetaMask, Phantom)
  lib/compose/   the Compose page: deposit SendParam with the lzCompose option, vault reads, personal_sign withdrawal, permissionless lz_compose
  components/    shell, explainer, under-the-hood, lifecycle pipeline, charts, diagrams
  pages/         the nine demos
contracts/
  stellar/postcard-oapp, stellar/faucet, stellar/composer-vault   Rust (soroban-sdk 25.1.1)
  evm/src                                 Solidity (TestOFT with a testnet faucet, PostcardOApp)
  wasm/, evm/artifacts/                   committed build outputs + manifest
scripts/         build-wasm.sh, compile-evm.ts, deploy-testnet.ts, e2e-testnet-send.ts, e2e-compose.ts, verify-registry.ts, smoke.ts
tests/           vitest
```

## Links

- [LayerZero on Stellar](https://docs.layerzero.network/v2/developers/stellar/overview) · [OFT on Stellar](https://docs.layerzero.network/v2/developers/stellar/oft/overview) · [Deployed contracts](https://docs.layerzero.network/v2/deployments/deployed-contracts) · [Debugging messages](https://docs.layerzero.network/v2/concepts/troubleshooting/debugging-messages)
- [USDT0 deployments](https://docs.usdt0.to/technical-documentation/deployments) · [Stellar docs: USDT0](https://developers.stellar.org/docs/tokens/usdt0-layerzero)
- [LayerZero Scan](https://layerzeroscan.com) · [Scan API spec](https://scan.layerzero-api.com/v1/openapi) · [Registry](https://metadata.layerzero-api.com/v1/metadata/deployments)
- [Dune: Stellar LayerZero OFT volume](https://dune.com/stellar/stellar-layerzero-oft-volume)
- Inspiration: [ElliotFriend/stellar-cctp-demo](https://github.com/ElliotFriend/stellar-cctp-demo)

MIT licensed. Fork it.
