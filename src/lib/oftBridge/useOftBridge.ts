/**
 * The interactive OFT round trip, as a hook: balances, trustline, faucet,
 * quote + send Stellar -> EVM (wallet-kit signed), send back EVM -> Stellar
 * (MetaMask signed), and the Scan trackers for both. Pure logic; pages render it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { encodeFunctionData } from 'viem';
import type { EvmTestnetKey } from '@/config/networks';
import { useWallets } from '@/lib/wallets/WalletProvider';
import { useAsyncAction, useLoader, toLoaded } from '@/lib/useLoader';
import { loadEvmBalances, loadStellarBalances } from '@/lib/playground/balances';
import { fundWithFriendbot } from '@/lib/stellar/friendbot';
import { prepareChangeTrust } from '@/lib/stellar/classic';
import { prepareInvoke, submitAndPoll } from '@/lib/stellar/tx';
import { prepareOftSend, quoteOft, quoteSend, type SendParam } from '@/lib/stellar/oft';
import { sc } from '@/lib/stellar/scval';
import { evmAddressToBytes32, bytesToHex, isEvmAddress } from '@/lib/hex';
import { stellarAddressToBytes32, isStellarAccount } from '@/lib/stellar/strkey';
import { evmQuoteSend, evmSend } from '@/lib/evm/oft';
import { OFT_ABI } from '@/lib/evm/abi/oft';
import { publicClient } from '@/lib/evm/clients';
import { useMessageTracker } from '@/lib/layerzero/useMessageTracker';
import { useConsole } from '@/components/ui';
import { parseUnits } from '@/lib/format';

export interface BridgeConfig {
  stellar: { oft: string; sac: string; assetCode: string; issuer: string; faucet: string | null };
  evm: { oft: Address; chainKey: EvmTestnetKey; eid: number };
  defaults?: { out?: string; back?: string };
}

export function useOftBridge(cfg: BridgeConfig | null) {
  const { stellar, evm } = useWallets();
  const console_ = useConsole();

  const stBalances = useLoader(
    () => (stellar.address && cfg ? toLoaded(loadStellarBalances(stellar.address, cfg.stellar.assetCode, cfg.stellar.issuer)) : Promise.resolve({ status: 'unavailable' as const, data: null, error: 'connect a Stellar wallet', fetchedAt: null })),
    [stellar.address, cfg?.stellar.sac],
  );
  const evmBalances = useLoader(
    () => (evm.address && cfg ? toLoaded(loadEvmBalances(cfg.evm.chainKey, evm.address, cfg.evm.oft)) : Promise.resolve({ status: 'unavailable' as const, data: null, error: 'connect MetaMask', fetchedAt: null })),
    [evm.address, cfg?.evm.oft],
  );
  const hasTrustline = stBalances.data?.mock !== null && stBalances.data?.mock !== undefined;

  const signSubmit = useCallback(
    async (label: string, unsignedXdr: string) => {
      console_.log('info', `${label}: unsigned envelope (XDR)`, undefined, unsignedXdr);
      const signed = await stellar.signTransaction(unsignedXdr);
      console_.log('info', `${label}: signed by wallet`, undefined, signed);
      const res = await submitAndPoll('testnet', signed);
      console_.log('ok', `${label}: confirmed`, `tx ${res.hash}`, res.returnValue);
      return res;
    },
    [stellar, console_],
  );

  const fund = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address) throw new Error('connect a Stellar wallet first');
      const r = await fundWithFriendbot(stellar.address);
      console_.log('ok', `Friendbot funded ${stellar.address} (${r.hash})`);
      stBalances.reload();
      return r;
    }, [stellar.address, console_, stBalances]),
  );
  const trustline = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !cfg) throw new Error('connect a Stellar wallet');
      const tx = await prepareChangeTrust('testnet', stellar.address, cfg.stellar.assetCode, cfg.stellar.issuer);
      const r = await signSubmit(`changeTrust ${cfg.stellar.assetCode}`, tx.toXDR());
      stBalances.reload();
      return r.hash;
    }, [stellar.address, cfg, signSubmit, stBalances]),
  );
  const drip = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !cfg?.stellar.faucet) throw new Error('connect a Stellar wallet');
      const prepared = await prepareInvoke('testnet', stellar.address, cfg.stellar.faucet, 'drip', [sc.address(stellar.address)]);
      const r = await signSubmit('faucet.drip(you) → sac_manager.mint under MINTER_ROLE', prepared.unsignedXdr);
      stBalances.reload();
      return r.hash;
    }, [stellar.address, cfg, signSubmit, stBalances]),
  );

  // ---- Stellar -> EVM ----
  const [amountOut, setAmountOut] = useState(cfg?.defaults?.out ?? '25');
  const [evmRecipient, setEvmRecipient] = useState('');
  useEffect(() => {
    if (evm.address && !evmRecipient) setEvmRecipient(evm.address);
  }, [evm.address, evmRecipient]);
  const [outQuote, setOutQuote] = useState<{ sent: bigint; received: bigint; fee: bigint } | null>(null);
  const [outTx, setOutTx] = useState<string | null>(null);
  const outParam = useMemo((): SendParam | null => {
    if (!cfg || !isEvmAddress(evmRecipient)) return null;
    try {
      return { dstEid: cfg.evm.eid, to: evmAddressToBytes32(evmRecipient), amountLd: parseUnits(amountOut || '0', 7), minAmountLd: 0n, extraOptions: new Uint8Array() };
    } catch {
      return null;
    }
  }, [cfg, amountOut, evmRecipient]);
  const quoteOut = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !cfg || !outParam) throw new Error('connect a Stellar wallet and enter an EVM recipient');
      const o = await quoteOft('testnet', cfg.stellar.oft, stellar.address, outParam);
      const f = await quoteSend('testnet', cfg.stellar.oft, stellar.address, outParam, false);
      console_.log('info', 'quote_oft / quote_send simulated', `sent ${o.value.receipt.amountSentLd} received ${o.value.receipt.amountReceivedLd}; native_fee ${f.value.nativeFee} stroops`, { quoteOftXdr: o.txXdr, quoteSendXdr: f.txXdr });
      const q = { sent: o.value.receipt.amountSentLd, received: o.value.receipt.amountReceivedLd, fee: f.value.nativeFee };
      setOutQuote(q);
      return q;
    }, [stellar.address, cfg, outParam, console_]),
  );
  const sendOut = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !cfg || !outParam || !outQuote) throw new Error('quote first');
      const prepared = await prepareOftSend('testnet', cfg.stellar.oft, stellar.address, { ...outParam, minAmountLd: outQuote.received }, { nativeFee: outQuote.fee, zroFee: 0n }, stellar.address);
      console_.log('info', 'OFT.send: SendParam', undefined, { dst_eid: outParam.dstEid, to: bytesToHex(outParam.to), amount_ld: outParam.amountLd.toString(), min_amount_ld: outQuote.received.toString(), fee_native: outQuote.fee.toString() });
      const r = await signSubmit('OFT.send(from, send_param, fee, refund)', prepared.unsignedXdr);
      setOutTx(r.hash);
      stBalances.reload();
      return r.hash;
    }, [stellar.address, cfg, outParam, outQuote, signSubmit, console_, stBalances]),
  );
  const outTracker = useMessageTracker('testnet', outTx);
  const outStatus = outTracker.messages[0]?.status.name;
  useEffect(() => {
    if (outStatus === 'DELIVERED') evmBalances.reload();
  }, [outStatus, evmBalances]);

  // ---- EVM -> Stellar ----
  // snippet:start bridgeSendBack
  const [amountBack, setAmountBack] = useState(cfg?.defaults?.back ?? '5');
  const [stRecipient, setStRecipient] = useState('');
  useEffect(() => {
    if (stellar.address && !stRecipient) setStRecipient(stellar.address);
  }, [stellar.address, stRecipient]);
  const [backTx, setBackTx] = useState<string | null>(null);
  const sendBack = useAsyncAction(
    useCallback(async () => {
      if (!evm.walletClient || !evm.address || !cfg) throw new Error('connect MetaMask');
      if (!isStellarAccount(stRecipient)) throw new Error('recipient must be a G… account with a trustline');
      if (evm.wrongNetwork) throw new Error('switch MetaMask to the expected network');
      const to = bytesToHex(stellarAddressToBytes32(stRecipient)) as Hex;
      const p = { dstEid: 40600, to, amountLD: parseUnits(amountBack || '0', 6), minAmountLD: 0n };
      const fee = await evmQuoteSend(publicClient(cfg.evm.chainKey), cfg.evm.oft, p);
      const data = encodeFunctionData({ abi: OFT_ABI, functionName: 'send', args: [{ ...p, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' }, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, evm.address] });
      console_.log('info', `OFT.send calldata (value ${fee.nativeFee} wei)`, undefined, { to: cfg.evm.oft, value: fee.nativeFee.toString(), data });
      const hash = await evmSend(evm.walletClient, cfg.evm.oft, p, fee.nativeFee, evm.address);
      console_.log('ok', `MetaMask submitted ${hash}`);
      setBackTx(hash);
      evmBalances.reload();
      return hash;
    }, [evm, cfg, stRecipient, amountBack, console_, evmBalances]),
  );
  // snippet:end bridgeSendBack
  const backTracker = useMessageTracker('testnet', backTx);
  const backStatus = backTracker.messages[0]?.status.name;
  useEffect(() => {
    if (backStatus === 'DELIVERED') stBalances.reload();
  }, [backStatus, stBalances]);

  return {
    wallets: { stellar, evm },
    console: console_,
    stBalances,
    evmBalances,
    hasTrustline,
    fund,
    trustline,
    drip,
    out: { amount: amountOut, setAmount: setAmountOut, recipient: evmRecipient, setRecipient: setEvmRecipient, param: outParam, quote: outQuote, quoteAction: quoteOut, sendAction: sendOut, tx: outTx, tracker: outTracker },
    back: { amount: amountBack, setAmount: setAmountBack, recipient: stRecipient, setRecipient: setStRecipient, sendAction: sendBack, tx: backTx, tracker: backTracker },
  };
}
