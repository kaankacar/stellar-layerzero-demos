#!/usr/bin/env bash
# Run 0 of the USDT0 Field Note: read-only mainnet recon.
# No keypair signs anything. Every contract read is a simulateTransaction via the Stellar CLI;
# account and asset facts come from Horizon. Output is timestamped so it can be cited.
set -uo pipefail

CODE=USDT0
ISSUER=GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q
EXPECTED_SAC=CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF
OFT=CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6
ENDPOINT=CCQLLRE5JBAWYCW3KTWOIWLMFDUOKROQVZNSALQMGOSXNW3ERUOWTZGK
ULN=CCV4HEII3UC65THWGSRM2DVIJLB6HS6YMUHDTTHUECX2RHTP5FA2GOBA
RPC_URL="${STELLAR_RPC_URL:-https://mainnet.sorobanrpc.com}"
PASSPHRASE="Public Global Stellar Network ; September 2015"
NET=(--rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE")
EVM_TO="${EVM_TO:-0xa7f6E56fa9FD580E51a8E48514d1001b44DBAc85}"
TO=000000000000000000000000${EVM_TO#0x}

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { echo; echo "[$(ts)] ## $*"; }
read_only() { stellar contract invoke --id "$1" "${NET[@]}" --source-account "$ISSUER" -- "${@:2}" 2>/dev/null; }

echo "# USDT0 mainnet recon, read-only. CLI $(stellar --version | head -1). RPC $RPC_URL"

say "1. Issuer account flags, home_domain, thresholds, signers (Horizon)"
curl -s "https://horizon.stellar.org/accounts/$ISSUER" | python3 -I -c 'import sys,json; a=json.load(sys.stdin); print(json.dumps({"flags":a["flags"],"home_domain":a.get("home_domain"),"thresholds":a["thresholds"],"signers":a["signers"],"last_modified":a["last_modified_time"]}, indent=1))'

say "2. SAC derivation must match the published address"
DERIVED=$(stellar contract id asset --asset "$CODE:$ISSUER" "${NET[@]}"); echo "derived $DERIVED"; [ "$DERIVED" = "$EXPECTED_SAC" ] && echo "MATCH" || echo "MISMATCH"

say "3. SAC metadata and admin"
for fn in decimals name symbol admin; do printf '%s: ' "$fn"; read_only "$EXPECTED_SAC" "$fn"; done

say "4. OFT wiring"
for fn in token shared_decimals decimal_conversion_rate oft_type endpoint is_paused; do printf '%s: ' "$fn"; read_only "$OFT" "$fn"; done
printf 'endpoint eid: '; read_only "$ENDPOINT" eid

say "5. Peers (null = not wired)"
for eid in 30101 30110 30111 30109 30184 30102 30383; do printf 'peer(%s): ' "$eid"; read_only "$OFT" peer --eid "$eid"; done

say "6. Route config toward Ethereum (30101)"
printf 'effective_fee_bps(30101): '; read_only "$OFT" effective_fee_bps --dst_eid 30101
printf 'enforced_options(30101, msg_type 1): '; read_only "$OFT" enforced_options --eid 30101 --msg_type 1
printf 'rate_limit_config(Outbound, 30101): '; read_only "$OFT" rate_limit_config --direction Outbound --eid 30101
printf 'effective_send_uln_config(OFT, 30101): '; stellar contract invoke --id "$ULN" "${NET[@]}" --source-account "$ISSUER" -- effective_send_uln_config --sender "$OFT" --dst_eid 30101 2>&1 | tail -1

say "7. Dust: quote_oft with 1.0000001 USDT0 (10000001 stroops) and a zero floor"
DISCOVER='{"dst_eid":30101,"to":"'"$TO"'","amount_ld":"10000001","min_amount_ld":"0","extra_options":"","compose_msg":"","oft_cmd":""}'
read_only "$OFT" quote_oft --from "$ISSUER" --send_param "$DISCOVER"

say "8. Messaging fee in XLM stroops for 5 USDT0 to each wired EVM chain"
for eid in 30101 30110 30111 30109; do
  P='{"dst_eid":'"$eid"',"to":"'"$TO"'","amount_ld":"50000000","min_amount_ld":"0","extra_options":"","compose_msg":"","oft_cmd":""}'
  printf 'quote_send(%s): ' "$eid"; read_only "$OFT" quote_send --from "$ISSUER" --pay_in_zro false --send_param "$P"
done

say "9. Asset stats (Horizon /assets)"
curl -s "https://horizon.stellar.org/assets?asset_code=$CODE&asset_issuer=$ISSUER" | python3 -I -c 'import sys,json; r=json.load(sys.stdin)["_embedded"]["records"][0]; print(json.dumps({"accounts":r["accounts"],"balances":r["balances"],"num_claimable_balances":r["num_claimable_balances"],"num_contracts":r["num_contracts"],"contracts_amount":r["contracts_amount"]}, indent=1))'

say "10. Recent USDT0 messages leaving Stellar (LayerZero Scan, last 20)"
curl -s "https://scan.layerzero-api.com/v1/messages/latest?srcChainIds=30600&limit=20" | python3 -I -c '
import sys,json
d=json.load(sys.stdin).get("data",[])
oft="CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6".lower()
n=sum(1 for m in d if (m.get("pathway",{}).get("sender",{}).get("address","") or "").lower()==oft or "usdt0" in json.dumps(m).lower())
newest=d[0]["source"]["tx"]["blockTimestamp"] if d else None
print(len(d), "messages fetched,", n, "from the USDT0 OFT; newest unix ts", newest)'

echo; echo "[$(ts)] done"
