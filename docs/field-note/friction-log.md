# USDT0 on Stellar: friction log

What slowed me down while building with USDT0 and LayerZero V2 on Stellar between the mainnet launch on 2 September and 8 October 2026. One row per problem: what I was doing, what went wrong, and the fix or workaround with a link where one exists. Status is as of 8 October 2026: **fixed** (in my code), **open** (still there), **by design** (not a bug, but worth writing down).

Companion to the Field Note: [USDT0-field-note.md](USDT0-field-note.md). Demo repo: https://github.com/kaankacar/stellar-layerzero-demos. Run logs with timestamps: [runs/](runs/).

## A. Building the contracts

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| A1 | Adding the LayerZero Stellar crates to a Cargo project | They are not on crates.io. The npm packages ship source only, and `@layerzerolabs/build-utils-rust` returns 404 on npm. | Vendor one copy of each crate from `monorepo-external` at a pinned commit and rewrite the path dependencies: [build-wasm.sh](../../scripts/build-wasm.sh). | open |
| A2 | Building against a symlinked monorepo tree | Cargo saw the same crate at two paths and refused. | One canonical copy per crate, `endpoint-v2` flattened out of its workspace: [vendor_rewrite.py](../../scripts/lib/vendor_rewrite.py). | fixed |
| A3 | Building with a fresh lockfile | `E0433 IntoValForContractFn not in soroban_sdk`, nine times. `soroban-sdk 25.1.1` pulls `soroban-sdk-macros` 25.3.x, which needs rustc 1.91. | Pin `soroban-sdk-macros = "=25.1.1"` and lock `soroban-spec` and `soroban-spec-rust` to 25.1.1: [skill file, status note of 4 September](https://github.com/stellar/stellar-dev-skill/blob/main/skills/cross-chain/layerzero.md). | open |
| A4 | Compiling the OApp skeleton from the docs | `E0463 can't find crate for std`, then 28 cascading errors. | Add `#![no_std]`; the snippet omitted it. | fixed |
| A5 | Rebuilding the wasm from a fresh clone | Same toolchain, same pinned commit, every `.wasm` differs from the committed bytes. | None yet. The manifest's sha256 values say what is deployed: [run2-fresh-clone.log](runs/run2-fresh-clone.log). | open |
| A6 | Starting the site | No prebuilt wasm, no TypeScript encoder for options or `set_config`, no minimal EVM OFT in the monorepo. | Wrote them: [options.ts](../../src/lib/layerzero/options.ts), [endpoint.ts](../../src/lib/stellar/endpoint.ts), [TestOFT.sol](../../contracts/evm/src/TestOFT.sol). | open |

## B. Writing an OApp on Stellar

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| B1 | Sending the first postcard from a bare OApp | ULN302 rejected it with `#1114 InvalidOptions` after a successful quote. Empty caller options went straight to the endpoint. The OFT calls `combine_options` for you; a bare OApp does not. | Call `Self::combine_options(env, dst_eid, msg_type, options)` before `__quote` and `__lz_send`: commit [d8dc222](https://github.com/kaankacar/stellar-layerzero-demos/commit/d8dc222). | fixed |
| B2 | Wiring peers | `__quote` panics without a peer, and `set_peer` must be called by `authorizer()`. Neither is documented. | Set peers on both sides first, from the admin. | by design |
| B3 | Encoding executor options | No Stellar documentation for the bytes. | Type 3 options: `0x0003`, worker id `0x01`, size u16, option type `0x01`, gas u128 big-endian: [options.ts](../../src/lib/layerzero/options.ts). | open |
| B4 | Choosing a recipient | Recipients and peers are raw 32-byte payloads, not strkeys. At delivery time the OFT checks whether a contract exists at those bytes; if not, it falls back to a G account nobody controls. Muxed M addresses do not fit. | Decode with `StrKey.decode*` and confirm the contract exists before the source chain sends. | by design |
| B5 | Setting a peer with the CLI | `Option<BytesN<32>>` needs a JSON-quoted hex string, and a wrong shape silently stores `None`. | Set peers through the SDK and read them back: [deploy-testnet.ts](../../scripts/deploy-testnet.ts). | open |
| B6 | Paying fees in ZRO | Failures surface in two places with two errors, `ZroUnavailable` and `ZroTokenUnavailable`. | `pay_in_zro: false`. | by design |
| B7 | Calling `require_auth` in my own OApp before send | The send path asks for auth again. | Use `FeePayer::Verified`: [postcard-oapp/src/lib.rs](../../contracts/stellar/postcard-oapp/src/lib.rs). | by design |
| B8 | Filtering contract events | `#[contractevent]` names are snake_case on the wire; filters for `composeSent` or `packetSent` miss. | Filter on `compose_sent`, `packet_sent`. | by design |

## C. Testnet pathway and infrastructure

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| C1 | Sending from Stellar testnet with the default config, 4 September | `#1213 WorkerError::UnsupportedMessageLib` after `quote` succeeded. The ULN's default send and receive configs for the EVM testnets name a deprecated DVN. | Per-OApp `endpoint.set_config` (`config_type` 2 and 3) naming the active DVN: [tx 9d0d471b](https://stellar.expert/explorer/testnet/tx/9d0d471b90a5c94143bb8dd09dc803fa731145a9891fd2338bec706d6fd7cea4), [deploy-testnet.ts](../../scripts/deploy-testnet.ts). | open |
| C2 | Trusting a quote | A successful `quote` does not mean `send` will work. `get_fee` does not check the message library. | Treat quote as pricing only. | by design |
| C3 | Using addresses from my September brief | Every testnet address was stale. The endpoint was redeployed in August without a changelog, and for a while two contracts claimed EID 40600. | Resolve addresses from the registry at runtime, snapshot as fallback: [verify-registry.ts](../../scripts/verify-registry.ts). | open |
| C4 | Sending Sepolia to Stellar testnet | My 11 September message sat at "Ready for DVNs to verify" for 25 days and 8 hours. Arbitrum Sepolia to Stellar attests in seconds. | Moved the EVM side to Arbitrum Sepolia on 29 September. Delivered the old message myself on 7 October once the DVN attested: [Scan](https://testnet.layerzeroscan.com/tx/0x2a4ca88f8fdc264ac1c1b382acc4fb7e10077b186e7465e37e28dbf57dd3d234), [run2b-reverse-delivery.log](runs/run2b-reverse-delivery.log). | open |
| C5 | Waiting for the testnet executor | 8 to 90 minutes for EVM delivery in September. Nobody but me ever executed the compose message. | Execution is permissionless: `commitVerification` plus `lzReceive` on EVM, `commit_verification` plus `lz_receive` on Stellar. The Tracker has a button for it: commits [3f934ba](https://github.com/kaankacar/stellar-layerzero-demos/commit/3f934ba), [dc36133](https://github.com/kaankacar/stellar-layerzero-demos/commit/dc36133). | open |
| C6 | Looking up a Stellar send on Scan right after sending | 404 for minutes. Scan indexes Stellar messages by GUID first and fills in the source tx later. | Read the GUID from the endpoint's `packet_sent` event and query `/messages/guid/`: commit [09b1aea](https://github.com/kaankacar/stellar-layerzero-demos/commit/09b1aea). | fixed |
| C7 | Delivering a 26-day-old Sepolia message | No public Sepolia RPC still returned its receipt. publicnode and 1rpc said null, drpc wants a paid plan, blockpi, omniatech and blast are gone. | Tenderly's public gateway still had it. Keep your own hashes and receipts: [run2b-reverse-delivery.log](runs/run2b-reverse-delivery.log). | open |
| C8 | Sending a postcard to Arbitrum Sepolia | The executor's simulation reverted with empty data. My enforced `lzReceive` gas for the postcard was 200k, copied from the OFT; a five-field struct with a string needs about 263k. Empty revert data is what out-of-gas looks like on Scan. | Enforced options raised to 500k (txs `ebf5750b…`, `f34dba19…`); the deploy script gives the postcard its own budget. The next postcard was delivered by the executor in 42 s: [guid 0x9f22a9b3…](https://testnet.layerzeroscan.com/tx/0x9f22a9b3639ee7ba026fc8a329fe7151ec343dc7226ffd5f1a70ecd27112d614). | fixed |
| C9 | Reading the registry | `deployments` keys Stellar as `stellar-mainnet` and `stellar-testnet`, `metadata` uses `stellar`, Scan uses `stellar` and `stellar-testnet`. | Map them once. | open |
| C10 | Listing testnet pathways | HyperCore appears in the testnet API with no registry EID. | Skip it. | open |
| C11 | Decoding an error | Codes are 1-based per-enum ranges with no public map. | My own table: [KNOWN_CONTRACT_ERRORS](../../src/lib/stellar/simulate.ts). | open |
| C12 | Quoting through the Transfer API | 401 without an early-access key, and the `/tokens?chainKey=` filter is ignored server-side. | Quote on-chain with `quote_oft` and `quote_send`; filter client-side. | by design |
| C13 | Reading mainnet from a browser | Public Soroban RPCs rate-limit bursts and keep about 7 days of events. Some 429s carry no CORS headers, so the browser reports a CORS error. | Cap concurrency at 4 and fail over across three RPCs. | open |

## D. Wallets and the EVM side

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| D1 | Sending from MetaMask on Arbitrum | A reverting call made MetaMask fall back to the block gas limit and show a fee of tens of thousands of ETH. | Simulate through the wallet's provider first so the real revert reason shows: commit [77439ab](https://github.com/kaankacar/stellar-layerzero-demos/commit/77439ab). | fixed |
| D2 | Submitting on Arbitrum | "max fee per gas less than block base fee". The base fee drifts between estimate and submission, and MetaMask adds no buffer there. | Cap `maxFeePerGas` at three times the base fee; the unused part is refunded: commit [eddc249](https://github.com/kaankacar/stellar-layerzero-demos/commit/eddc249). | fixed |
| D3 | Checking whether a message is executable | `executable()` lives in `EndpointV2View`, not the endpoint. | Derive the state from `inboundPayloadHash` and `lazyInboundNonce`: commit [3f934ba](https://github.com/kaankacar/stellar-layerzero-demos/commit/3f934ba). | fixed |
| D4 | Waiting for the compose to execute | 29 September: still queued 20 minutes after the tokens landed. 7 October: tokens delivered in 40 s, compose still queued after 4 min 35 s. | `lz_compose` is callable by anyone once queued; the vault relies on `clear_compose` for authenticity: commit [cfbd370](https://github.com/kaankacar/stellar-layerzero-demos/commit/cfbd370). | open |
| D5 | Running the compose rehearsal | The EVM key had no Arbitrum Sepolia ETH. | Bridged Sepolia ETH through the Arbitrum Inbox; the deposit needs about 190k gas: [run3-compose.log](runs/run3-compose.log). | fixed |
| D6 | Running it again with ETH on the key | Still "total cost exceeds the balance". My fee-cap fix (D2) passed `maxFeePerGas` into `simulateContract` with no gas limit, and Arbitrum's `eth_call` then checks the balance against the 2^50 block gas limit. | Simulate without fee fields, write with the cap: [run3-compose.log](runs/run3-compose.log). | fixed |

## E. USDT0 itself

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| E1 | Looking for a testnet to rehearse on | USDT0 has no testnet deployment: [deployments](https://docs.usdt0.to/technical-documentation/developer/usdt0-deployments). | A mock that mirrors the admin model (locked issuer, SAC-manager admin, MintBurn OFT), labelled loudly, plus one small real transfer. | by design |
| E2 | Quoting an amount with seven decimals | `quote_oft(10000001)` returns `amount_sent_ld 10000000`. Seven local decimals, six shared, conversion rate 10. With a route fee the remainder goes into the fee instead. | Always call `quote_oft` first and use its receipt as the floor: [run0-recon.log](runs/run0-recon.log). | by design |
| E3 | Explaining the mechanism | "Burn and mint on both ends" is wrong for Ethereum. Stellar's OFT is `MintBurn`; Ethereum's is an adapter that locks canonical USDT with `approvalRequired = true`. | Approve first on Ethereum; never promise symmetry. | by design |
| E4 | Receiving on a G account | The inbound mint fails without a trustline. | Create the trustline first, or deliver to a contract. | by design |
| E5 | Validating the asset the SEP-1 way | No `home_domain`, so no `stellar.toml`. `name()` returns `CODE:ISSUER`. | Supply the display name and icon yourself; pin the issuer. | open |
| E6 | Picking the asset by code | Many assets share the code USDT or USDT0. | Pin code and issuer, and check the SAC derivation equals `CBSJZEIO…`. | by design |
| E7 | Reviewing who can freeze | The issuer is revocable and clawback-enabled with master weight 0; the SAC admin is a contract owned by a OneSig multisig. | Document it. | by design |
| E8 | Reading fees | Two fees in two denominations: the messaging fee in XLM stroops, the OFT fee in USDT0. | Keep them apart. Overpaying is refunded. | by design |
| E9 | Discovering a route with a real slippage floor | `SlippageExceeded` hides whether a route is expensive or broken. Both quotes assert the floor. | Quote with 0, show the user, re-quote with their floor. | by design |
| E10 | Writing down a fee | The messaging fee to Ethereum was 3.55 XLM on 10 September, 11.95 XLM on 7 October, 6.50 XLM on 8 October. | Quote live, every time. | by design |
| E11 | Writing down configuration | Peers, pause state, fee bps, rate limits and the DVN set are live. The registry listed seven DVN operators on 29 September; USDT0 requires three. | Read it live; the Inspector does. | by design |
| E12 | Using the experimental OFT list endpoint | It did not include a Stellar entry for USDT0. | Hardcode the three Stellar addresses from docs.usdt0.to with a verification: [usdt0.ts](../../src/config/usdt0.ts). | open |
| E13 | Funding a brand-new Stellar account from ETH only | The account cannot receive USDT0, or anything, until someone creates it with XLM. | NEAR Intents 1Click, no API key: 0.004 ETH became 49.95 XLM and it created the account itself, in three minutes: [run1-mainnet.log](runs/run1-mainnet.log). | by design |
| E14 | Timing the real round trip on 8 October | Ethereum to Stellar took 16 min 27 s, 13 to 16 of them waiting for the three DVNs' Ethereum confirmations. Stellar to Ethereum took 27 min 28 s, almost all of it the 320 Stellar confirmations. | Tell users to expect 15 to 30 minutes on the Ethereum route; Arbitrum is seconds: [Scan inbound](https://layerzeroscan.com/tx/0x3fcb30ce4f0ced62ba5c3f73a8a38efb969dd4aefb74bf7727c91d4ab603e304), [Scan outbound](https://layerzeroscan.com/tx/6bc5348acd5dfa908c8d8ff8401d5cce5e659566b0f6707a84950b16ca7410e8). | by design |
| E15 | Approving USDT on Ethereum | Tether's USDT reverts on a non-zero to non-zero `approve`. Not hit here, the allowance was zero. | Reset to zero first when changing a live allowance: [run1-mainnet.ts](../../scripts/fieldnote/run1-mainnet.ts). | by design |

## F. Docs and tooling

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| F1 | Reading LayerZero's docs from a script | The pages are client-rendered; curl gets nothing. | Use the metadata API and on-chain reads. | open |
| F2 | Looking for pre-listing checks in stellar-docs | The [USDT0 page](https://developers.stellar.org/docs/tokens/usdt0-layerzero) is deliberately lean and links out. | The checks live in the [skill file](https://github.com/stellar/stellar-dev-skill/blob/main/skills/cross-chain/layerzero.md). | by design |
| F3 | Simulating a read with the Stellar CLI | `--source-account` needs an existing account. | Any funded mainnet account works; the issuer does. | by design |
| F4 | Guessing argument names | `effective_send_uln_config` takes `--sender` and `--dst_eid`, not what the Rust signature suggests. | `stellar contract invoke … -- <fn> --help`. | by design |
| F5 | Submitting the first mainnet send from Stellar | Rejected with `txTOO_LATE` although the quotes took one second and all three RPCs answered in under 0.4 s. | A 600 s time bound instead of 120 s worked in four seconds. Cause not established: [run1-mainnet.log](runs/run1-mainnet.log). | open |
