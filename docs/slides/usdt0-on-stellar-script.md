# USDT0 on Stellar — spoken script

Deck: https://docs.google.com/presentation/d/1BWXlA6-R7LbtA3qdwwIcNvFymUSn6bcCPMxhkdrkUEE/edit

One section per slide, in the deck's order. Each section's title is the slide's title as it reads in the deck today. The text under it is what to say, word for word. Lines in square brackets are stage directions, not speech. Put each section into the speaker notes of its slide, or show it as captions.

Talk time without demos: about 12 minutes. The demo block on slide 13 adds about 18 minutes.

---

## Slide 1 — USDT0 on Stellar

Hi everyone. Today we look at USDT0 on Stellar.

USDT0 is Tether's USDT, delivered to Stellar over LayerZero's OFT standard. It has been live on Stellar mainnet since the second of September.

I will cover three things. First, how it works under the hood. Second, what you, as a developer, can read, send and track. Third, a live tour of nine demos that you can fork today.

Everything I show is in one public repo, and every address I mention is verified on chain.

---

## Slide 2 — One USDT supply, many chains, much layers

Let's start with what USDT0 is.

USDT0 is Tether's USDT moved over LayerZero's Omnichain Fungible Token standard. The canonical USDT stays locked in an adapter contract on Ethereum. Every other chain holds USDT0 that was minted against that locked supply.

Everdawn Labs builds and operates USDT0. USDT itself is Tether's asset. Please keep that attribution straight when you write about it.

USDT0 is live on twenty-three networks, and Stellar is one of them.

One important ground rule. USDT0 exists on Stellar mainnet only. There is no USDT0 on testnet. Anything called USDT0 on testnet is somebody's mock. The LayerZero endpoint itself is live on testnet, so your own test tokens work there, and that is exactly what the demos use.

---

## Slide 3 — Where USDT0 on Stellar stands today

Here is where we stand, with numbers read from chain on the twenty-eighth of September.

Twenty-three thousand seven hundred and seventeen accounts hold a USDT0 trustline. That number was thirteen and a half thousand two weeks earlier, so it grew by three quarters in seventeen days.

About two point five eight million USDT0 sit on Stellar. Almost all of it is held inside twenty-three contracts.

All twenty-one USDT0 networks that have a LayerZero endpoint id are wired as peers on the Stellar contract. I read that from the contract itself.

And seven DVN operators are registered on Stellar mainnet. USDT0 requires three of them. We will see what a DVN is in a moment.

One more thing. USDT0 is the biggest tenant on LayerZero on Stellar, but not the only one. Of the last fifty messages leaving Stellar, thirty-eight were USDT0. The rest came from apps that LayerZero Scan labels PayPal and Ethena.

---

## Slide 4 — Each leg has its own mechanism

Now the mechanics. An OFT keeps one total supply across chains by pairing a debit on the source with a credit on the destination. But the mechanism differs per leg.

On Stellar, the OFT type is MintBurn. When you send, your USDT0 is burned through the Stellar Asset Contract. When you receive, a contract called the SAC-manager mints to you. So the supply on Stellar always equals what was bridged in.

On Ethereum it is different. There, the OFT is an adapter. Sending locks canonical USDT in the adapter, and you have to approve it first. Receiving unlocks it. Nothing is ever minted on Ethereum.

The invariant is the whole security story. USDT0 minted on every other chain equals USDT locked in the Ethereum adapter. So never promise burn and mint on both ends of a route. Check the leg.

---

## Slide 5 — Shared decimals: 7 on Stellar, 6 on the wire

Chains disagree on decimals. Stellar has seven. USDT on Ethereum has six. OFTs solve this with a shared precision, and for USDT0 that is six. On the wire, amounts travel as a sixty-four bit integer in those six decimals.

Follow the table. You type one point two three four five six seven eight. That is twelve million three hundred forty-five thousand six hundred seventy-eight stroops. The conversion rate is ten. So the wire amount is one million two hundred thirty-four thousand five hundred sixty-seven. The last digit, eight stroops, is dust. It is removed before the message is built, and it stays in your account.

The practical rule: call quote underscore oft first. It returns the exact amount that will arrive. Use that as your minimum amount, or the send fails on slippage.

---

## Slide 6 — How a message reaches Stellar

A LayerZero message is not a transaction that travels. It is five steps.

One, send. The source OFT calls the endpoint, and a packet is emitted with a nonce, the source and destination endpoint ids, sender, receiver and payload.

Two, verify. Each required DVN, that is a Decentralized Verifier Network, independently attests the packet on the destination chain.

Three, commit. Once the required set has attested, the verification is committed on the receive library. Anyone can call this.

Four, execute. An executor calls lz underscore receive on the destination OFT with the payload. Anyone can be the executor.

Five, mint. On Stellar, the OFT asks the SAC-manager to mint USDT0 to the recipient.

For USDT0 going from Stellar to Ethereum, the real configuration requires three DVNs, LayerZero Labs, Canary and USDT0's own, after three hundred and twenty Stellar confirmations. The Inspector page reads that live. Notice that steps three and four are permissionless. Keep that in mind, we will use it.

---

## Slide 7 — Three contracts, one token

Here is the Stellar twist. On EVM chains, one contract is both the token and the LayerZero app. On Stellar it is three pieces.

First, the classic asset USDT0. Its issuer account is locked. Master weight zero, no signers. The flags allow freezing and clawback, like Tether does on every chain. There is no home domain, so no stellar dot toml.

Second, the Stellar Asset Contract. That is the SEP-41 view of the asset, with balance, transfer and burn. Its admin is not a key. It is a contract.

Third, that admin contract, the SAC-manager. It holds the admin role and mints only for holders of the minter role. The OFT holds that role. The SAC-manager itself is owned by a OneSig multisig.

Fourth, the OFT contract, the actual LayerZero app. It has quote, send and lz receive, it stores the peers and the enforced options, and it points at the SAC and at the endpoint.

The Inspector page verifies these relationships live every time you open it.

---

## Slide 8 — Reading USDT0 needs no key and no signature

Everything about USDT0 is readable without a key, a signature or an API key.

Horizon gives you the classic ledger side. The assets endpoint returns the supply split, the holder count and the issuer flags. The accounts endpoint shows you that the issuer has master weight zero.

Soroban RPC gives you the contract side through simulate transaction. Token, oft type, peer, is paused. Quote oft and quote send. The SAC admin. The effective ULN configuration. You simulate against any funded account. Nothing is signed.

And the registry is the source of truth for every LayerZero address. The Stellar testnet endpoint was redeployed in August, and every hardcoded address from before is stale. Fetch the registry at runtime.

You can do all of this from the Stellar CLI too. Contract invoke with any account as source runs a simulation, no signing.

---

## Slide 9 — Sending USDT0 from Stellar

Sending is five steps, and it is a normal Soroban invocation.

Build the send parameter. Destination endpoint id, the recipient as thirty-two raw bytes, the amount, the minimum amount, extra options and a compose message.

Call quote oft to get the exact amount that arrives, and use it as the minimum.

Call quote send to get the fee. You pay it in XLM.

Call send. The OFT burns your USDT0 through the SAC and the endpoint emits packet sent, with the GUID.

Then track the GUID on LayerZero Scan until it says delivered.

Four details that cost real money if you get them wrong. The recipient is raw bytes, the Ed25519 key of a G address or the id of a C address, never the strkey string. A G recipient on Stellar needs a trustline before the message lands. The OFT combines enforced options for you. And dust below one millionth never leaves your account.

---

## Slide 10 — Tracking a message, and finishing it yourself

Tracking uses the LayerZero Scan API. No key needed. Look up by transaction hash, by GUID, or list the latest messages for Stellar.

One quirk on testnet. Scan indexes Stellar messages by GUID first, so the transaction link can lag by minutes. Read the GUID from the packet sent event on chain and query by GUID.

Now the part I like most. Delivery is permissionless. Once the required DVNs have attested, anyone can finish the message. On EVM that is commit verification, then lz receive on the endpoint. On Stellar it is the same pair, with you as the executor.

The Tracker page has a button for it, and the repo has scripts. The very first test transfer in this repo was delivered that way, because the testnet executor took anywhere from eight to ninety minutes.

---

## Slide 11 — Two stablecoins on Stellar, two bridge models

The first question I get from Stellar developers is how this differs from CCTP, so here is the honest comparison.

USDC uses Circle's Cross-Chain Transfer Protocol. USDT0 uses LayerZero's OFT standard.

Who verifies? For USDC, Circle's attestation service. For USDT0, the DVN set that each application configures. USDT0 requires three of the seven registered on Stellar.

Token model. USDC is native on every chain, burned on the source and minted on the destination. USDT0 keeps canonical USDT locked in an Ethereum adapter and mints USDT0 everywhere else.

Who operates? Circle on one side. Everdawn Labs, LayerZero Labs and the other DVN operators on the other.

Both have a page in the Stellar docs under Tokens. Both have a demo repo you can fork. And many apps will end up holding both.

---

## Slide 12 — Nine demos, two modes, one static site

That brings us to the demo site. Nine pages, two modes, one static site. No backend, no secrets in the bundle.

The mainnet pages are read only. Inspector, Tracker, Quotes and Dashboard read the real USDT0 through Horizon, RPC simulation, the registry and Scan. They never ask you to sign.

The testnet pages are interactive. Playground with a mock token called tUSDT0. Postcards for raw messages without tokens. Launchpad to deploy your own omnichain token. And Compose, a Soroban vault driven entirely from MetaMask. Freighter and MetaMask sign through the live testnet endpoint, and the EVM side is Arbitrum Sepolia.

Every page has the same shape. What is happening, the live demo, and the real code it just ran, extracted from the repo at build time.

[Switch to the browser.]

---

## Slide 13 — Run order, about 18 minutes

[Keep this slide visible on the second screen while the browser is up. It is the run order.]

Let me show you. Everything you see on the testnet pages is a mock. No real funds.

First, the Inspector. Live facts, the three-contract check, the twenty-one wired peers, and the required DVN set.

Then the Tracker. We pick a message delivered today and walk through source, DVN attestations, commit and execution.

Then Quotes. Quote send to five destinations on chain, the fee in XLM, and the dust calculator.

Then the Playground. A faucet drip of tUSDT0, a send from Stellar to Arbitrum Sepolia with Freighter, and tracking. If the executor lags, we deliver it ourselves.

Then Compose. MetaMask only. We deposit tUSDT0 into a Soroban vault with a compose message, watch lz compose credit the EVM address, and withdraw with a MetaMask signature that the contract verifies on Stellar.

And if time allows, the Launchpad. Twelve steps to launch a LockUnlock token.

[Return to the slides after the demos.]

---

## Slide 14 — Six things that bit us on testnet

Six things that bit us, so they do not bite you.

Addresses from older guides fail, because the testnet endpoint was redeployed in August. Resolve everything from the registry.

Send fails with error twelve thirteen right after a successful quote. The default library configuration still names a deprecated DVN. Set a per-app configuration that names the active one.

A bare app send fails with error eleven fourteen. Empty options went straight to the endpoint. Call combine options first. The OFT does this for you, your own app must do it itself.

Scan returns four oh four for a Stellar transaction for minutes. It indexes by GUID first. Read the GUID from the event.

Sepolia to Stellar testnet has waited on the DVN since the ninth of September. So we moved the EVM side to Arbitrum Sepolia, where the same DVN attests in seconds.

And delivery can take an hour and a half. Deliver it yourself, from the Tracker or a script.

---

## Slide 15 — Fork it, then build one of these

Fork it. The site is MIT licensed, has no backend, and deploys to GitHub Pages as is. The links are on the slide: the live site, the repo, the Stellar docs page, the LayerZero docs and the Dune dashboard.

Three ideas that fit a weekend.

Composed messages the other way. The Compose page goes from EVM to Stellar. Build the mirror: a Solidity composer that reacts to a transfer sent from Stellar.

A Solana leg with Phantom. Deploy the Solana OFT program on devnet and peer it as a third chain. The wallet slot is already in the repo.

And a stuck-message alert bot. Poll Scan for in-flight messages on Stellar pathways and post to Slack or Discord with a Tracker link. A GitHub Action on a cron is enough.

---

## Slide 16 — Questions?

That is it. Slides, code and every address are in the repo.

If you send a real USDT0 message during this call, paste the hash into the Tracker and we will watch it land together.

Questions?

[Likely questions: fees in XLM versus destination gas. What happens if a DVN goes offline: the message waits, nothing is lost. Will USDT0 come to testnet: no, mock it. How this compares with CCTP: slide 11.]
