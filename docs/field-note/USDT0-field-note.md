# Field Note No. 01: USDT0 on Stellar

*We tried deploying this asset into our environment.*

> Cover: [card/card.png](card/card.png), paired with `DR-3_usdt0-field-note_04-scan-inbound.png` (the real inbound delivery on LayerZero Scan).

## Attribution

- **Built by:** Kaan Kacar, Developer Relations, Stellar Development Foundation. GitHub [kaankacar](https://github.com/kaankacar). Live demo: https://kaankacar.github.io/stellar-layerzero-demos/
- **Release:** USDT0 went live on Stellar mainnet on 2 September 2026 (Everdawn Labs operates USDT0; USDT is Tether's asset). Follow-up deep dive at the Stellar Developer Meeting of 1 October 2026 ([recording](https://www.youtube.com/watch?v=Zo8LK7puSTc)).
- **Demo:** video `DR-3_usdt0-field-note_2026-10-07.mp4`; open source repo https://github.com/kaankacar/stellar-layerzero-demos (Apache-2.0).
- **Repos and packages used:**
  - `LayerZero-Labs/monorepo-external` at commit `b013ffef` (release 1.2.53): the Stellar OFT, SAC-manager, OApp and endpoint crates, vendored because they are not on crates.io. Our contracts (`postcard-oapp`, `composer-vault`, `faucet`) are new code on top of those crates.
  - `@layerzerolabs/oft-evm` 4.0.1 and `@layerzerolabs/oapp-evm` 0.4.1 with OpenZeppelin 5.6 for the EVM side (`TestOFT.sol`, `PostcardOApp.sol`), compiled with solc-js, no Foundry.
  - `ElliotFriend/stellar-cctp-demo` as the model for a one-repo, many-pages demo.
  - `stellar/stellar-dev-skill` (`skills/cross-chain/layerzero.md`) and the stellar-docs page [USDT0 Transfers with LayerZero](https://developers.stellar.org/docs/tokens/usdt0-layerzero), both written during this work.
  - Nothing was forked. The testnet token `tUSDT0` is our own mock of USDT0's contract shape. It has no value and no relationship to Tether, Everdawn Labs or LayerZero Labs, and neither does this note.

## 1. What we built

The headline is small on purpose: **a Soroban vault that an EVM user can fund from MetaMask in one hop, without holding XLM.** The user calls `send` on an OFT on Arbitrum Sepolia with a 32-byte recipient that is our vault contract and a `composeMsg` that is a short note. On Stellar the OFT mints the tokens to the vault and queues a compose message. `lz_compose` then credits the sender's EVM address inside the vault. Withdrawals to any G or C address are authorised by a `personal_sign` signature that the contract verifies with `secp256k1_recover`. The whole thing is about 250 lines of Rust ([composer-vault](../../contracts/stellar/composer-vault/src/lib.rs)) and one page of React ([Compose.tsx](../../src/pages/Compose.tsx)).

Around it sits a nine-page demo site that I needed anyway to understand what I was doing: an animated explainer, a mainnet Inspector, a message Tracker with a "deliver it yourself" button, a fee explorer, a testnet Playground with the mock token, cross-chain Postcards (raw OApp messaging), a Launchpad that deploys a USDT0-shaped omnichain token from the browser in twelve signed steps, a dashboard, and the Compose page.

**Goal.** Learn what it takes to build *with* USDT0 rather than just list it, and leave a trail that makes the next developer faster.

**Blockers, in order of pain.** (1) There is no USDT0 on testnet, so every rehearsal needs a mock. (2) In August the Stellar testnet LayerZero deployment could not send at all. (3) After the August redeploy, the default DVN configuration still broke out-of-the-box sends. (4) Inbound messages from Sepolia sat unverified for 25 days. (5) The crates are not published, so the build is a vendoring exercise. The full list is in the [friction log](friction-log.md), about 50 rows.

**Time.** About six working days spread over nine weeks: a one-day dry run on 3 August that ended in "cannot send", the docs page on 25 August, the testnet fix on 4 September, two days building the site on 10 and 11 September, one day for Compose on 29 September, and the runs in this note on 7 October. Most of the calendar time was waiting for testnet infrastructure, not building.

## 2. How it went

Everything below is reproducible from the repo. Timestamps come from the logs in [runs/](runs/).

### Run 0: look before you touch (mainnet, read-only)

`scripts/fieldnote/run0-recon.sh` signs nothing. Every contract read is a `simulateTransaction` through the Stellar CLI, with the issuer as the envelope source. On 7 October it returned:

- Issuer `GATISXX6…`: `auth_revocable` and `auth_clawback_enabled` set, master weight 0, no signers, no `home_domain`. Nobody can sign for the issuer; the SAC admin is a contract.
- `stellar contract id asset --asset USDT0:GATISXX6…` derives `CBSJZEIO…`, which matches docs.usdt0.to. Pin both the code and the issuer; the namespace is open.
- OFT `CBOWOLFS…`: `token()` is the SAC, `shared_decimals` 6, `decimal_conversion_rate` 10, `oft_type` MintBurn with the SAC-manager `CA3GUWLO…` as minter, not paused, endpoint EID 30600.
- Peers wired to Ethereum, Arbitrum, Optimism, Polygon and Plasma among others; Base and BSC null.
- Route to Ethereum: fee 0 bps, enforced `lzReceive` gas 80,000, no rate limit, and the ULN config that actually protects the route: three required DVNs (LayerZero Labs, Canary, USDT0's own) at 320 Stellar confirmations.
- Dust, live: `quote_oft` with `amount_ld 10000001` returns `amount_sent_ld 10000000`.
- Messaging fee for 5 USDT0: 11.95 XLM to Ethereum, 0.45 XLM to Arbitrum, 1.21 XLM to Optimism, 0.32 XLM to Polygon. On 10 September the Ethereum figure was 3.55 XLM. Quote live, every time.
- Horizon: 25,691 trustlines, 2.81 million USDT0 in accounts and 2.97 million in 25 contracts.

Screenshot: `DR-3_usdt0-field-note_01-recon.png`.

### Run 1: one real round trip (mainnet, a few dollars)

[[RUN1 PENDING: filled from runs/run1-mainnet.log once the steps complete. Planned shape below.]]

1. **XLM for a fresh account.** The new account `GB54KUSW…` cannot receive anything until someone creates it. We funded it from ETH on Ethereum through NEAR Intents 1Click (no API key): 0.004 ETH quoted at 49.6 XLM. [[result, time, whether the account creation worked]]
2. **Trustline** to `USDT0:GATISXX6…`. Without it the inbound message would land and the mint would fail.
3. **ETH to USDT** on Uniswap V3 (`SwapRouter02`, 0.05% pool), 0.0025 ETH. [[tx]]
4. **Approve and send on Ethereum.** The Ethereum side is an OFT *adapter* (`approvalRequired = true`): it locks canonical USDT. `quoteOFT` for 5 USDT returned 5 USDT received and no fee; `quoteSend` priced the message at 0.0000103 ETH. [[approve tx, send tx, Scan link, time to DELIVERED]]
5. **Back to Ethereum from Stellar.** `quote_oft(49999999)` returned `amount_sent_ld 49999990`, so ten stroops stayed behind. `quote_send` priced the message at [[n]] XLM. [[tx, Scan link, time to DELIVERED, USDT unlocked on Ethereum]]

Screenshots: `02-trustline`, `03-eth-send`, `04-scan-inbound`, `05-stellar-balance`, `06-quote-dust`, `07-stellar-send`, `08-scan-outbound`.

### Run 2: a fresh clone, timed, and a 25-day-old message (testnet)

A clean clone on the same machine, Rust 1.90.0, pinned monorepo commit:

| Step | Time |
|---|---|
| `git clone` | 4 s |
| `pnpm install` | 25 s |
| `pnpm verify-registry` | 0.4 s, no drift |
| `pnpm build:wasm` (five contracts, vendored crates) | 2 min 10 s |

The rebuilt wasm did not match the committed bytes. The manifest's sha256 values are the source of truth for what is deployed, but the build is not yet reproducible, and that goes in the log (A5).

Then the message we sent from Sepolia on 11 September, which the Tracker screenshot from that day shows stuck at "Ready for DVNs to verify". On 6 October at 22:36 UTC the LayerZero Labs testnet DVN finally attested it, 25 days and 8 hours later. No executor followed. On 7 October at 14:07 UTC we delivered it ourselves: `commit_verification` ([9b966203…](https://stellar.expert/explorer/testnet/tx/9b966203ad16c525b4bc72e7f3259ef64fdecbdf69be961c36d12e957f24339b)) then `lz_receive` ([3afb9a4f…](https://stellar.expert/explorer/testnet/tx/3afb9a4fb941a41368bdd4d176b92966a7d55369694c43d5aec4bf9cab80ec56)), and 5 tUSDT0 landed. A detail that cost ten minutes: no public Sepolia RPC still served the receipt of a 26-day-old transaction except Tenderly's gateway (C9).

The same afternoon, `pnpm e2e:testnet` sent 10 tUSDT0 from Stellar to Arbitrum Sepolia and the real executor delivered it in under three minutes. The postcard that followed failed at the executor's simulation with empty revert data. The cause was ours: the postcard's enforced `lzReceive` gas was 200k, copied from the OFT, and a five-field struct with a string needs about 263k (measured when we delivered it by hand with a 400k limit). Our only earlier postcard delivery had also been by hand, so the executor path had never been proven. Enforced gas is now 500k, and the next postcard was delivered by the executor in 42 seconds (C10).

Screenshots: `09-fresh-clone-build`, `10-reverse-delivered`.

### Run 3: the Compose vault, end to end (testnet)

`pnpm e2e:compose` is the Compose page without the browser: the EVM key deposits 5 tUSDT0 plus a note into the vault through the OFT, the message is tracked to delivery, `lz_compose` is awaited and then executed by us if nobody else does it, and 2 tUSDT0 are withdrawn with a `personal_sign` signature from the same key.

It took three attempts, and both failures were ours. The first died because the key had no Arbitrum Sepolia ETH (we bridged 0.004 Sepolia ETH through the Arbitrum Inbox; that itself reverted once because I forced a 120k gas limit on a call that needs 190k). The second died with the same "total cost exceeds the balance" message even with ETH on the key. The cause was a bug our own 1 October fee-cap fix introduced: `simulateContract` carried `maxFeePerGas` with no gas limit, and Arbitrum's `eth_call` then checks the balance against the block gas limit, 2^50 gas. Three `balanceOf` calls side by side proved it (D6). Simulations now carry no fee fields; the cap goes on the write.

The third attempt, timeline from LayerZero Scan and Horizon:

| Step | Time (UTC) | Evidence |
|---|---|---|
| `send` with `composeMsg` on Arbitrum Sepolia, fee 0.0000318 ETH | 14:34:37 | [0x02b78681…](https://testnet.layerzeroscan.com/tx/0x02b78681adabc61efda81fb930d78071f4f78dc7e4135e5db4a09ca142447cb0) |
| LayerZero Labs DVN attested on Stellar testnet | 14:34:52 (+15 s) | Scan |
| Executor delivered the tokens to the vault | 14:35:17 (+40 s) | [b007d84f…](https://stellar.expert/explorer/testnet/tx/b007d84f0a6969dc28c6cda190d8dfe007836822faf19bd1cb316ef8ffa0de8d) |
| Compose still queued, nobody executed it; we called `lz_compose` ourselves | 14:39:12 (+4 min 35 s) | [9eca85da…](https://stellar.expert/explorer/testnet/tx/9eca85dab68ccb253a7dbc50615deb6d38cf62240bba94c0b1d14f787da88a94) |
| Vault credited the EVM address 3 -> 8 tUSDT0 with the note "compose from Arbitrum Sepolia @ 2026-10-07T14:34" | same ledger | vault state |
| `withdraw` 2 tUSDT0 to a G address, authorised by the EVM signature | 14:39:17 | [68867e77…](https://stellar.expert/explorer/testnet/tx/68867e778ba28265a7972e5777497452969a11ad9ad2d5489cffa979684e3387) |

Forty seconds from MetaMask-style send to tokens in a Soroban contract, with no XLM in the user's hands. The compose leg is the part the testnet executor still does not finish, so the page keeps its "execute `lz_compose`" button.

Screenshots: `11-compose-deposit`, `12-compose-withdraw`.

## 3. The mental model that made it click

**On EVM, one contract; on Stellar, four pieces.** On Ethereum or Arbitrum, the OFT *is* the token (or an adapter wraps one). On Stellar the same thing is a classic asset with a locked issuer, the Stellar Asset Contract that gives it a SEP-41 interface, a SAC-manager contract that holds the SAC's admin role and mints on behalf of whoever has `MINTER_ROLE`, and the OFT contract that talks to the LayerZero endpoint. Once I drew those four boxes (they are the etching on the cover) everything else fell into place: the Inspector reads each one, the Launchpad deploys each one, and the mock mirrors each one.

**Burn or lock is decided per leg.** Stellar's OFT is MintBurn. Ethereum's is an adapter that locks canonical USDT. Never promise "burn and mint on both ends"; look at the leg.

**A quote is a price, not a permission.** `quote_oft` tells you what arrives, `quote_send` tells you the XLM cost, and neither checks whether the DVN will take the job. Quote with a zero floor to discover, show the user, re-quote with their floor, then send.

**The seventh decimal never leaves.** Seven local decimals, six shared, floor division by ten. On a no-fee route the dust stays in your account; on a fee route it is absorbed into the fee.

**Delivery is permissionless, so you can be the executor.** After the DVNs attest, anyone can commit the verification and call `lz_receive` (or `lzReceive` on EVM). Every stuck message in this note was finished by us, with a button in the Tracker or a script.

**Compose means the token arrives with a note attached.** `send` with a `composeMsg` does two things on the destination: the OFT delivers the tokens to the recipient contract, and the endpoint queues a second, separately executed call, `lz_compose`. The endpoint's `clear_compose` is what proves the payload is genuine, so the vault does not need to trust the executor's identity.

**A G recipient needs a trustline before the message lands; a C recipient needs to exist.** Recipients are 32 raw bytes. The OFT checks whether a contract exists at those bytes at delivery time; if not, it treats them as an account key. Confirm the destination before the source chain sends.

## 4. Friction log

The ten that matter most. The full log, about 50 rows with status and owner, is [friction-log.md](friction-log.md) and doubles as the feedback we are sending to LayerZero Labs and Everdawn Labs.

1. **No USDT0 on testnet.** Mock it, label it, and do one dust-sized real transfer. (E1)
2. **Testnet sends failed with `#1213 UnsupportedMessageLib` after a successful quote.** First because the DVN rejected the only registered library (August), then because the default configs still named a deprecated DVN (September). Per-OApp `set_config` fixes the second; nothing fixed the first except time. (C1, C2)
3. **The Sepolia to Stellar testnet DVN went quiet for 25 days.** Arbitrum Sepolia attests in seconds. (C6)
4. **The testnet executor is slow or absent.** Deliver it yourself. (C7, D4)
5. **A bare OApp must call `combine_options`.** Empty options reach ULN302 and fail with `#1114`. The OFT does it for you; your own OApp does not. (B2)
6. **The crates are not on crates.io and the build tool 404s on npm.** Vendor one canonical copy and pin `soroban-sdk-macros = "=25.1.1"`. (A1 to A3)
7. **The testnet endpoint was redeployed without notice.** Resolve addresses from the registry at runtime. (C4)
8. **Scan indexes Stellar messages by GUID first.** A tx-hash lookup 404s for minutes while the message is already visible. (C8)
9. **MetaMask on Arbitrum.** A reverting call shows as tens of thousands of ETH; the base fee drifts between estimate and submission. Simulate first, cap the fee at three times base. (D1, D2)
10. **Fees move.** 3.55 XLM to Ethereum on 10 September, 11.95 XLM on 7 October. (E10)

What I would tell the next builder in one line: *preflight the pathway before writing any code, and treat every address and number as live.*

## 5. Where we think this goes

USDT0 is the first production OFT on Stellar, and its shape (SAC-manager plus OFT over a locked classic issuer) is now a pattern, not a one-off. The Launchpad proves any issuer can take the same four pieces and go omnichain from a browser in a few minutes. Compose is the part I would watch: it turns "bridge, then do something" into "deposit into the app in one hop", so an EVM user can use a Soroban application without ever touching XLM. On testnet we paid the Stellar fee with a Friendbot key; on mainnet that becomes fee sponsorship or a relayer, which is a solved problem on Stellar. The thing holding builders back is not the mainnet deployment, which works; it is the testnet, where defaults, DVN liveness and executor coverage all need to be as boring as mainnet before people can rehearse.

## 6. Try it yourself

- **Repo:** https://github.com/kaankacar/stellar-layerzero-demos
- **Live site:** https://kaankacar.github.io/stellar-layerzero-demos/
- **Quickstart:**
  ```bash
  git clone https://github.com/kaankacar/stellar-layerzero-demos && cd stellar-layerzero-demos
  pnpm install && pnpm dev            # the site, mainnet pages are read-only
  pnpm build:wasm                     # Rust 1.90.0, wasm32v1-none; vendors the LayerZero crates
  pnpm e2e:testnet                    # script-signed proof of the testnet pathway (needs .env, see README)
  ./scripts/fieldnote/run0-recon.sh   # the read-only mainnet recon from this note
  ```
- **Mainnet addresses to pin:** asset `USDT0:GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q`, SAC `CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF`, OFT `CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6`, EID 30600.
- **Come and ask:** the weekly Stellar Developer Meeting (Thursdays), the USDT0 AMA that follows this note, and Hack Meridian in Lisbon on 25 and 26 October, where this repo is fair game to fork.
