# DR-3 USDT0 Field Note: demo video shot list

Target: 4 to 6 minutes, 1920x1080, no music needed, voice-over optional. File name `DR-3_usdt0-field-note_YYYY-MM-DD.mp4`. The first frame is the etching card ([card/card.png](card/card.png)).

Two kinds of footage. **Auto** shots are recorded headless from the live site and the terminal logs. **Wallet** shots need a human because Freighter and MetaMask prompts cannot be driven headless; record them with QuickTime (File > New Screen Recording, select the browser window, no system audio) at the same 1920x1080.

| # | Shot | Source | Length | What to show |
|---|---|---|---|---|
| 1 | Card | card.png | 3 s | Static, no motion. |
| 2 | Ground truth | Auto, site home | 8 s | The mainnet / testnet split and the line "USDT0 does not exist on Stellar testnet". |
| 3 | Inspector | Auto, `/inspector` | 15 s | Scroll: issuer flags and locked key, SAC equals `CBSJZEIO…`, OFT type MintBurn, the three required DVNs with 320 confirmations. |
| 4 | Recon log | Auto, terminal | 10 s | `runs/run0-recon.log` section 7: `quote_oft(10000001)` returning `10000000`. Hold on the dust. |
| 5 | Real transfer in | Auto, terminal + Scan | 25 s | `runs/run1-mainnet.log` lines for the Ethereum `send`, then LayerZero Scan showing DELIVERED, then Horizon showing 5.0000000 USDT0 on the fresh account. |
| 6 | Real transfer out | Auto, terminal + stellar.expert | 20 s | `return` step: `quote_send` fee in XLM, the Stellar tx, Scan DELIVERED, the dust that stayed behind. |
| 7 | Compose, wallet | **Wallet**, `/compose` with MetaMask on Arbitrum Sepolia | 60 s | Connect MetaMask, faucet if needed, deposit 5 tUSDT0 with a note, watch the tracker to DELIVERED, press "execute lz_compose" if the executor lags, see the vault credit the EVM address. |
| 8 | Compose, withdraw | **Wallet**, same page | 30 s | `personal_sign` the withdrawal to a G address; show the Stellar balance change. |
| 9 | Deliver it yourself | Auto, `/tracker` | 20 s | Paste the 11 September guid `0x2a4ca88f…`; show the 25-day DVN wait and the two delivery transactions from 7 October. |
| 10 | Playground, wallet | **Wallet**, `/playground` with Freighter | 40 s | Trustline + faucet, send 1 tUSDT0 to Arbitrum Sepolia, watch it arrive. Optional if time is short. |
| 11 | Friction log | Auto, friction-log.md rendered on GitHub | 15 s | Slow scroll over sections C and E. |
| 12 | Try it yourself | Auto, README | 8 s | Repo URL and live site URL on screen. |

## Recording the auto shots

`docs/field-note/record-broll.mjs` (puppeteer-core `page.screencast()`) records shots 2, 3, 9, 11 and 12 as WebM at 1920x1080 from the live site. Terminal shots 4, 5 and 6 are recorded with the same script by rendering the log text in a monospace page. Convert and concatenate with ffmpeg:

```bash
ffmpeg -loop 1 -t 3 -i docs/field-note/card/card.png -vf "scale=1920:1080" card.mp4
# one line per clip, same codec and size
ffmpeg -f concat -safe 0 -i clips.txt -c:v libx264 -pix_fmt yuv420p -r 30 DR-3_usdt0-field-note_2026-10-DD.mp4
```

## Wallet shots: what to say while recording (optional voice-over)

- Shot 7: "Only a MetaMask here. The OFT send carries a note, the vault on Stellar receives the tokens and the note in one hop, and anyone can execute the compose if the executor is slow."
- Shot 8: "The withdrawal is authorised by an Ethereum signature; the contract recovers the key with `secp256k1_recover`."
- Shot 10: "This is the mock. USDT0 itself has no testnet; this is the same shape with a locked issuer and a SAC-manager."
