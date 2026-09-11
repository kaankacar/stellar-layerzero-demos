# Contributing

This repo is meant to be forked at a hackathon. Here is how it fits together and five concrete things to build on top of it.

## Getting around

- `pnpm dev` runs the site. Mainnet pages need nothing else; testnet pages read `src/config/testnet-deployment.json`.
- Every page follows the same pattern: `Explainer` (what is happening), the demo, `UnderTheHood` (real code). Snippets come from `// snippet:start <name>` / `// snippet:end <name>` markers in source files, imported with Vite's `?raw`. If you add a snippet, `tests/` has a check that referenced names exist; keep it green.
- Network calls go through `fetchJson` + `loadWithCache` so every panel has loading / live / stale / fallback / unavailable states. Please keep that: the site must not white-screen when an API is down.
- Contract addresses come from the registry (`src/lib/layerzero/chains.ts`). Do not hardcode a LayerZero address in a page; add it to `src/config/layerzero.fallback.ts` as a documented fallback and let the registry win.
- TypeScript strict, no `any` in exported APIs, `pnpm typecheck && pnpm lint && pnpm test` before a PR. `pnpm smoke` opens every route in headless Chrome and screenshots it.
- Secrets live only in `.env` (gitignored) and are read only by `scripts/`. The website never handles a secret key beyond wallet extensions.

## Rebuilding the contracts

- Stellar: `pnpm build:wasm` vendors LayerZero's crates from `LayerZero-Labs/monorepo-external` at the commit pinned in `scripts/build-wasm.sh`, builds with Rust 1.90.0 for `wasm32v1-none`, and writes `contracts/wasm/manifest.json` with hashes. Our own contracts are `contracts/stellar/postcard-oapp` and `contracts/stellar/faucet`.
- EVM: `pnpm compile:evm` compiles `contracts/evm/src/*.sol` with solc-js against `@layerzerolabs/oft-evm`, `@layerzerolabs/oapp-evm` and OpenZeppelin 5.
- `pnpm deploy:testnet` is idempotent; delete `scripts/.state/testnet-deploy.json` to start over.

## Five extension ideas

1. **Solana OFT leg with Phantom.** Deploy the LayerZero Solana OFT program on devnet, add `solana-testnet` (EID 40168) as a third peer of the test OFT, and let Phantom sign a send from the Playground. `src/lib/solana/phantom.ts` and the `WalletProvider` slot are already there; you need the Anchor program, a `solana` transport, and peer wiring on all three sides. Note that the Postcards page deliberately skips Solana today.
2. **Composed messages.** The OFT `SendParam.compose_msg` and the endpoint's `send_compose` / `lz_compose` let a token transfer trigger a contract call on arrival. Build a tiny composer on Sepolia (or Stellar) that reacts to an incoming tUSDT0 transfer, and extend the Tracker's `Lifecycle` to render the `destination.lzCompose` field the Scan API already returns.
3. **Fee-history tracker.** Page 4 quotes once. Persist `quote_send` results per destination over time (localStorage, or a tiny Worker + KV) and chart the XLM fee against destination gas prices. `src/lib/usdt0/quotes.ts` and `components/charts/LineChart.tsx` are the starting points.
4. **Deeper multi-wallet support.** The Wallets Kit already exposes xBull, Albedo, Lobstr, Ledger and WalletConnect. Add wallet-specific network detection, a remembered wallet, `signAuthEntry` for contract-auth flows that are not source-account based, and a MetaMask alternative via EIP-6963 discovery UI (`src/lib/wallets/evmProvider.ts` lists every announced provider).
5. **Stuck-message alert bot.** Poll `GET /messages/status/INFLIGHT` and `/messages/latest?srcChainIds=30600` on a schedule, flag anything in flight for longer than N minutes or `BLOCKED`, and post to Slack/Discord with the Tracker deep link (`/tracker?env=mainnet&q=<tx>`). `src/lib/layerzero/scan.ts` is Node-compatible; a GitHub Action on a cron is enough.

Also worth doing: the Launchpad page (`src/pages/Launchpad.tsx`) deploys a plain `TestOFT`; let it deploy the `PostcardOApp` too, or add Arbitrum Sepolia as a second destination for a launched token (a second `set_peer` + `set_config`).

Smaller ones: generate TypeScript bindings for the OFT with `stellar contract bindings typescript` and compare with the hand-rolled wrappers; add Arbitrum Sepolia as a second EVM testnet (`EVM_TESTNET=arbitrum-sepolia` is already accepted by the scripts); a "verify this deployment" page that recomputes the wasm hashes in `contracts/wasm/manifest.json` against what is on chain.

## Style

- Explain mechanics, not marketing. Name the contract and the function.
- Short sentences. One idea each.
- Never present a testnet asset as the real USDT0.
