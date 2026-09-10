import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Hex } from 'viem';
import { encodeFunctionData } from 'viem';
import { PageHeader } from '@/components/Shell';
import { AddressChip, Callout, ConsolePanel, DataStatus, Explainer, Section, Spinner, StatTile, UnderTheHood, useConsole } from '@/components/ui';
import { Lifecycle } from '@/components/Lifecycle';
import { RegistryCheck } from '@/components/RegistryCheck';
import { ChainBadge } from '@/components/ChainBadge';
import { EVM_TESTNETS, explorers, STELLAR } from '@/config/networks';
import { deploymentReady, FAUCET_AMOUNT, TESTNET_DEPLOYMENT } from '@/config/testnet';
import { usePageNetworks, useWallets } from '@/lib/wallets/WalletProvider';
import { useAsyncAction, useLoader, toLoaded } from '@/lib/useLoader';
import { loadRegistry } from '@/lib/layerzero/chains';
import { loadHealth } from '@/lib/playground/health';
import { loadEvmBalances, loadStellarBalances } from '@/lib/playground/balances';
import { fundWithFriendbot } from '@/lib/stellar/friendbot';
import { prepareChangeTrust, prepareDeploySac, preparePayment, randomKeypair } from '@/lib/stellar/classic';
import { prepareInvoke, submitAndPoll } from '@/lib/stellar/tx';
import { prepareOftSend, quoteOft, quoteSend, type SendParam } from '@/lib/stellar/oft';
import { sc } from '@/lib/stellar/scval';
import { evmAddressToBytes32, bytesToHex, isEvmAddress } from '@/lib/hex';
import { stellarAddressToBytes32, isStellarAccount } from '@/lib/stellar/strkey';
import { evmQuoteSend, evmSend } from '@/lib/evm/oft';
import { OFT_ABI } from '@/lib/evm/abi/oft';
import { publicClient } from '@/lib/evm/clients';
import { useMessageTracker } from '@/lib/layerzero/useMessageTracker';
import { formatUnits, parseUnits, timeAgo } from '@/lib/format';
import { extractSnippet } from '@/lib/snippets';
import oftSrc from '@/lib/stellar/oft.ts?raw';
import txSrc from '@/lib/stellar/tx.ts?raw';
import walletSrc from '@/lib/wallets/WalletProvider.tsx?raw';
import classicSrc from '@/lib/stellar/classic.ts?raw';
import evmOftSrc from '@/lib/evm/oft.ts?raw';
import endpointSrc from '@/lib/stellar/endpoint.ts?raw';
import healthSrc from '@/lib/playground/health.ts?raw';
import deployNodeSrc from '../../scripts/lib/stellar-node.ts?raw';

const D = TESTNET_DEPLOYMENT;
const READY = deploymentReady(D);
const EVM_KEY = D.evm?.chainKey ?? 'sepolia';
const EVM = EVM_TESTNETS[EVM_KEY];

function StepHeader({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${done ? 'bg-ok/20 text-ok' : 'bg-accent/20 text-accent'}`}>{done ? '✓' : n}</span>
      <span>{title}</span>
    </div>
  );
}

export function PlaygroundPage() {
  usePageNetworks({ stellar: 'testnet', evm: EVM_KEY });
  const { stellar, evm } = useWallets();
  const console_ = useConsole();
  const registry = useLoader((f) => loadRegistry(f), []);
  const health = useLoader(() => toLoaded(loadHealth(registry.data)), [registry.data]);

  // ---- balances ----
  const stBalances = useLoader(() => (stellar.address && D.stellar ? toLoaded(loadStellarBalances(stellar.address, D.stellar.assetCode, D.stellar.issuer)) : Promise.resolve({ status: 'unavailable' as const, data: null, error: 'connect a Stellar wallet', fetchedAt: null })), [stellar.address]);
  const evmBalances = useLoader(() => (evm.address && D.evm?.oft ? toLoaded(loadEvmBalances(EVM_KEY, evm.address, D.evm.oft)) : Promise.resolve({ status: 'unavailable' as const, data: null, error: 'connect MetaMask', fetchedAt: null })), [evm.address]);
  const hasTrustline = stBalances.data?.mock !== null && stBalances.data?.mock !== undefined;

  // ---- step 0: friendbot ----
  const fund = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address) throw new Error('connect a Stellar wallet first');
      console_.log('info', `Friendbot: GET ${STELLAR.testnet.friendbot}/?addr=${stellar.address}`);
      const r = await fundWithFriendbot(stellar.address);
      console_.log('ok', `funded (${r.hash})`);
      stBalances.reload();
      return r;
    }, [stellar.address, console_, stBalances]),
  );

  // ---- step 1: trustline + faucet ----
  const signSubmit = useCallback(
    async (label: string, unsignedXdr: string) => {
      console_.log('info', `${label}: unsigned envelope (XDR)`, undefined, unsignedXdr);
      const signed = await stellar.signTransaction(unsignedXdr);
      console_.log('info', `${label}: signed by wallet`, undefined, signed);
      const res = await submitAndPoll('testnet', signed);
      console_.log('ok', `${label}: confirmed in ledger ${'ledger' in res.response ? res.response.ledger : '?'}`, `tx ${res.hash}`, res.returnValue);
      return res;
    },
    [stellar, console_],
  );
  const trustline = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !D.stellar) throw new Error('connect a Stellar wallet');
      const tx = await prepareChangeTrust('testnet', stellar.address, D.stellar.assetCode, D.stellar.issuer);
      const r = await signSubmit('changeTrust tUSDT0', tx.toXDR());
      stBalances.reload();
      return r.hash;
    }, [stellar.address, signSubmit, stBalances]),
  );
  const drip = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !D.stellar?.faucet) throw new Error('connect a Stellar wallet');
      const prepared = await prepareInvoke('testnet', stellar.address, D.stellar.faucet, 'drip', [sc.address(stellar.address)]);
      const r = await signSubmit('faucet.drip(you) → sac_manager.mint under MINTER_ROLE', prepared.unsignedXdr);
      stBalances.reload();
      return r.hash;
    }, [stellar.address, signSubmit, stBalances]),
  );

  // ---- step 3: Stellar -> EVM ----
  const [amountOut, setAmountOut] = useState('25');
  const [evmRecipient, setEvmRecipient] = useState('');
  useEffect(() => {
    if (evm.address && !evmRecipient) setEvmRecipient(evm.address);
  }, [evm.address, evmRecipient]);
  const [outQuote, setOutQuote] = useState<{ sent: bigint; received: bigint; fee: bigint } | null>(null);
  const [outTx, setOutTx] = useState<string | null>(null);
  const outParam = useMemo((): SendParam | null => {
    if (!D.evm || !isEvmAddress(evmRecipient)) return null;
    try {
      return { dstEid: D.evm.eid, to: evmAddressToBytes32(evmRecipient), amountLd: parseUnits(amountOut || '0', 7), minAmountLd: 0n, extraOptions: new Uint8Array() };
    } catch {
      return null;
    }
  }, [amountOut, evmRecipient]);
  const quoteOut = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !D.stellar?.oft || !outParam) throw new Error('connect Freighter and enter an EVM recipient');
      const o = await quoteOft('testnet', D.stellar.oft, stellar.address, outParam);
      const f = await quoteSend('testnet', D.stellar.oft, stellar.address, outParam, false);
      console_.log('info', 'quote_oft / quote_send simulated', `sent ${o.value.receipt.amountSentLd} received ${o.value.receipt.amountReceivedLd}; native_fee ${f.value.nativeFee} stroops`, { quoteOftXdr: o.txXdr, quoteSendXdr: f.txXdr });
      const q = { sent: o.value.receipt.amountSentLd, received: o.value.receipt.amountReceivedLd, fee: f.value.nativeFee };
      setOutQuote(q);
      return q;
    }, [stellar.address, outParam, console_]),
  );
  const sendOut = useAsyncAction(
    useCallback(async () => {
      if (!stellar.address || !D.stellar?.oft || !outParam || !outQuote) throw new Error('quote first');
      const prepared = await prepareOftSend('testnet', D.stellar.oft, stellar.address, { ...outParam, minAmountLd: outQuote.received }, { nativeFee: outQuote.fee, zroFee: 0n }, stellar.address);
      console_.log('info', 'OFT.send: SendParam', undefined, { dst_eid: outParam.dstEid, to: bytesToHex(outParam.to), amount_ld: outParam.amountLd.toString(), min_amount_ld: outQuote.received.toString(), fee_native: outQuote.fee.toString() });
      const r = await signSubmit('OFT.send(from, send_param, fee, refund)', prepared.unsignedXdr);
      setOutTx(r.hash);
      stBalances.reload();
      return r.hash;
    }, [stellar.address, outParam, outQuote, signSubmit, console_, stBalances]),
  );
  const outTracker = useMessageTracker('testnet', outTx);
  useEffect(() => {
    if (outTracker.messages[0]?.status.name === 'DELIVERED') evmBalances.reload();
  }, [outTracker.messages[0]?.status.name]);

  // ---- step 4: EVM -> Stellar ----
  const [amountBack, setAmountBack] = useState('5');
  const [stRecipient, setStRecipient] = useState('');
  useEffect(() => {
    if (stellar.address && !stRecipient) setStRecipient(stellar.address);
  }, [stellar.address, stRecipient]);
  const [backTx, setBackTx] = useState<string | null>(null);
  const sendBack = useAsyncAction(
    useCallback(async () => {
      if (!evm.walletClient || !evm.address || !D.evm?.oft) throw new Error('connect MetaMask');
      if (!isStellarAccount(stRecipient)) throw new Error('recipient must be a G… account (with a tUSDT0 trustline)');
      if (evm.wrongNetwork) throw new Error(`switch MetaMask to ${EVM.label}`);
      const to = bytesToHex(stellarAddressToBytes32(stRecipient)) as Hex; // the 32-byte payload, never the strkey string
      const p = { dstEid: 40600, to, amountLD: parseUnits(amountBack || '0', 6), minAmountLD: 0n };
      const client = publicClient(EVM_KEY);
      const fee = await evmQuoteSend(client, D.evm.oft, p);
      const data = encodeFunctionData({ abi: OFT_ABI, functionName: 'send', args: [{ ...p, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' }, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, evm.address] });
      console_.log('info', `TestOFT.send calldata (value ${fee.nativeFee} wei)`, undefined, { to: D.evm.oft, value: fee.nativeFee.toString(), data });
      const hash = await evmSend(evm.walletClient, D.evm.oft, p, fee.nativeFee, evm.address);
      console_.log('ok', `MetaMask submitted ${hash}`);
      setBackTx(hash);
      evmBalances.reload();
      return hash;
    }, [evm, stRecipient, amountBack, console_, evmBalances]),
  );
  const backTracker = useMessageTracker('testnet', backTx);
  useEffect(() => {
    if (backTracker.messages[0]?.status.name === 'DELIVERED') stBalances.reload();
  }, [backTracker.messages[0]?.status.name]);

  // ---- DIY issuer sandbox ----
  const [sandbox, setSandbox] = useState<{ issuer: ReturnType<typeof randomKeypair>; sac: string | null; funded: boolean; trust: boolean; minted: boolean } | null>(null);
  const sandboxStep = useAsyncAction(
    useCallback(
      async (step: 'gen' | 'sac' | 'trust' | 'mint') => {
        if (step === 'gen') {
          const kp = randomKeypair();
          console_.log('info', `sandbox issuer ${kp.publicKey()} (throwaway, in memory only)`);
          await fundWithFriendbot(kp.publicKey());
          setSandbox({ issuer: kp, sac: null, funded: true, trust: false, minted: false });
          return 'ok';
        }
        if (!sandbox || !stellar.address) throw new Error('generate an issuer and connect Freighter first');
        if (step === 'sac') {
          const { tx, contractId } = await prepareDeploySac('testnet', stellar.address, 'DIYUSD', sandbox.issuer.publicKey());
          await signSubmit('createStellarAssetContract(DIYUSD)', tx.toXDR());
          setSandbox({ ...sandbox, sac: contractId });
          return contractId;
        }
        if (step === 'trust') {
          const tx = await prepareChangeTrust('testnet', stellar.address, 'DIYUSD', sandbox.issuer.publicKey());
          await signSubmit('changeTrust DIYUSD', tx.toXDR());
          setSandbox({ ...sandbox, trust: true });
          return 'ok';
        }
        const tx = await preparePayment('testnet', sandbox.issuer.publicKey(), stellar.address, 'DIYUSD', sandbox.issuer.publicKey(), '1000');
        tx.sign(sandbox.issuer); // a payment FROM the issuer is minting; the sandbox key signs locally
        console_.log('info', 'issuer payment (= mint) signed by the throwaway issuer', undefined, tx.toXDR());
        const r = await submitAndPoll('testnet', tx.toXDR());
        console_.log('ok', `minted 1000 DIYUSD to you (tx ${r.hash})`);
        setSandbox({ ...sandbox, minted: true });
        stBalances.reload();
        return r.hash;
      },
      [sandbox, stellar.address, signSubmit, console_, stBalances],
    ),
  );

  const healthAllOk = health.data?.every((c) => c.ok) ?? false;

  return (
    <div className="space-y-6">
      <PageHeader title="Testnet OFT Playground" mode="testnet">
        Mint a mock <strong>tUSDT0</strong>, inspect how the test OFT is wired to LayerZero's Stellar testnet endpoint, then send it to {EVM.label} with Freighter and back with MetaMask. Everything here is testnet: no real value, no real USDT0.
      </PageHeader>

      <Callout tone="danger" title="This is a MOCK. The real USDT0 is mainnet-only.">
        <p>
          <code>tUSDT0</code> is issued by a throwaway account this repo controls, purely to exercise the OFT machinery. It has no value and is not related to Tether or Everdawn Labs. Anything called “USDT0” on Stellar testnet is someone's mock. The real asset is <Link className="text-accent hover:underline" to="/inspector">on mainnet</Link>.
        </p>
      </Callout>
      <Callout tone="warn" title="Testnet caveats">
        <p>Stellar testnet has a <strong>single DVN</strong> (LayerZero Labs), so “verification” here is one attestation. The testnet endpoint <strong>has been redeployed before</strong> and may be again; this app pulls addresses from the registry at runtime and checks the deployment below before letting you send. The library default configuration still names a deprecated DVN, which is why the deploy script sets a per-OApp ULN config.</p>
      </Callout>

      <Explainer id="playground">
        <p>
          The mock mirrors USDT0's real design exactly: a classic asset <code>tUSDT0</code> whose <strong>issuer is locked</strong> (flags revocable + clawback, master weight 0), a <strong>SAC</strong>, a <strong>SAC-manager</strong> that is the SAC's admin, an <strong>OFT</strong> in <code>MintBurn</code> mode that holds <code>MINTER_ROLE</code>, and a <strong>Faucet</strong> contract that also holds <code>MINTER_ROLE</code> so you can mint without any secret key leaving the server side. On {EVM.label} there is a plain <strong>TestOFT</strong> (the contract is the ERC20) and both OFTs are peers of each other.
        </p>
        <p>
          Steps 0–1 are Stellar-only. Step 2 reads the wiring live. Step 3 is the real thing: <code>quote_oft</code> → <code>quote_send</code> → <code>send</code>, signed by your wallet, then tracked on the testnet Scan API until {EVM.label} mints. Step 4 does the reverse with MetaMask. The console at the bottom records every envelope and calldata.
        </p>
      </Explainer>

      {!READY.stellar ? (
        <Callout tone="warn" title="Not deployed yet">
          <p>This build has no testnet deployment recorded. Run <code>pnpm build:wasm</code> then <code>pnpm deploy:testnet</code> (see README), commit <code>src/config/testnet-deployment.json</code>, and this page comes alive.</p>
        </Callout>
      ) : null}

      {/* Health */}
      <Section title="Deployment health" subtitle={`Recorded ${D.deployedAt ? timeAgo(D.deployedAt) : 'never'} · endpoint ${D.registry?.endpoint ?? '—'}`} right={<DataStatus state={health} reload={health.reload} />}>
        {health.data ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {health.data.map((c) => (
              <div key={c.label} className={`flex items-start gap-2 rounded-md border p-2 text-xs ${c.ok ? 'border-ok/40 bg-ok/5' : c.ok === false ? 'border-danger/40 bg-danger/5' : 'border-border bg-surface-2'}`}>
                <span className={c.ok ? 'text-ok' : c.ok === false ? 'text-danger' : 'text-muted'}>{c.ok ? '✓' : c.ok === false ? '✗' : '…'}</span>
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="mono break-all text-muted">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : health.status === 'loading' ? (
          <Spinner label="reading both OFTs, the SAC and the ULN config…" />
        ) : (
          <Callout tone="warn">{health.error}</Callout>
        )}
        {D.stellar ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {D.stellar.sac ? <AddressChip label="SAC" address={D.stellar.sac} href={explorers.stellarContract('testnet', D.stellar.sac)} /> : null}
            {D.stellar.sacManager ? <AddressChip label="SAC-manager" address={D.stellar.sacManager} href={explorers.stellarContract('testnet', D.stellar.sacManager)} /> : null}
            {D.stellar.oft ? <AddressChip label="OFT" address={D.stellar.oft} href={explorers.stellarContract('testnet', D.stellar.oft)} /> : null}
            {D.stellar.faucet ? <AddressChip label="Faucet" address={D.stellar.faucet} href={explorers.stellarContract('testnet', D.stellar.faucet)} /> : null}
            <AddressChip label="issuer (locked)" address={D.stellar.issuer} href={explorers.stellarAccount('testnet', D.stellar.issuer)} />
            {D.evm?.oft ? <AddressChip label={`TestOFT on ${EVM.label}`} address={D.evm.oft} href={explorers.evmAddress(EVM.explorer, D.evm.oft)} /> : null}
          </div>
        ) : null}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Step 0 */}
        <Section title={<StepHeader n={0} title="Connect wallets and fund" done={stellar.status === 'connected' && !!stBalances.data?.exists} />}>
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <ChainBadge chainKey="stellar-testnet" />
              {stellar.status === 'connected' ? <span className="mono text-xs">{stellar.address}</span> : <button className="btn" onClick={() => void stellar.connect()}>Connect Freighter / Stellar wallet</button>}
              {stellar.wrongNetwork ? <span className="text-xs text-warn">switch your wallet to Test Net</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ChainBadge chainKey={EVM.chainKey} />
              {evm.status === 'connected' ? <span className="mono text-xs">{evm.address}</span> : <button className="btn" onClick={() => void evm.connect()}>Connect MetaMask</button>}
              {evm.wrongNetwork ? <button className="text-xs text-warn hover:underline" onClick={() => void evm.switchToExpected()}>switch to {EVM.label}</button> : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <StatTile label="XLM (testnet)" value={stBalances.data?.exists ? `${Number(stBalances.data.xlm).toFixed(2)}` : stellar.address ? 'account not funded' : '—'} sub={<button className="text-accent hover:underline disabled:text-muted" disabled={!stellar.address || fund.status === 'loading'} onClick={() => void fund.run()}>{fund.status === 'loading' ? 'asking Friendbot…' : 'Fund with Friendbot (10,000 XLM)'}</button>} />
              <StatTile label="tUSDT0 on Stellar" value={hasTrustline ? formatUnits(parseUnits(stBalances.data!.mock!, 7), 7) : stellar.address ? 'no trustline' : '—'} sub="classic balance via Horizon" />
              <StatTile label={`tUSDT0 on ${EVM.label}`} value={evmBalances.data ? formatUnits(evmBalances.data.mock, 6) : '—'} sub={evmBalances.data ? `${(Number(evmBalances.data.eth) / 1e18).toFixed(4)} ETH for gas` : 'connect MetaMask'} />
            </div>
            {fund.error ? <div className="text-xs text-danger">{fund.error}</div> : null}
            <div className="text-xs text-muted">Need {EVM.label} ETH? Use any public faucet for {EVM.label}; the send back (step 4) costs a normal transaction plus the LayerZero fee.</div>
          </div>
        </Section>

        {/* Step 1 */}
        <Section title={<StepHeader n={1} title="Get mock tUSDT0" done={hasTrustline && Number(stBalances.data?.mock) > 0} />}>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted">Two transactions, both signed by your wallet: a trustline (a G account cannot hold an issued asset without one) and a call to the Faucet, which mints through the SAC-manager, exactly the path the OFT uses when a message arrives.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={!stellar.address || hasTrustline || trustline.status === 'loading' || !READY.stellar} onClick={() => void trustline.run()}>
                {hasTrustline ? '✓ trustline open' : trustline.status === 'loading' ? 'signing…' : '1a · Add tUSDT0 trustline'}
              </button>
              <button className="btn btn-primary" disabled={!stellar.address || !hasTrustline || drip.status === 'loading' || !READY.stellar} onClick={() => void drip.run()}>
                {drip.status === 'loading' ? 'minting…' : `1b · Faucet: mint ${formatUnits(FAUCET_AMOUNT, 7)} tUSDT0`}
              </button>
            </div>
            {trustline.error ? <div className="text-xs text-danger">{trustline.error}</div> : null}
            {drip.error ? <div className="text-xs text-danger">{drip.error.includes('9101') ? 'Cooldown: this address dripped recently (once per ~hour).' : drip.error}</div> : null}
            <details className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
              <summary className="cursor-pointer font-semibold">DIY issuer sandbox: issue your own classic asset (optional)</summary>
              <p className="mt-2 text-muted">See the classic mechanics without the OFT: a throwaway issuer is generated in your browser (never a real key of yours), funded, its SAC deployed, you open a trustline, and the issuer pays you 1,000 DIYUSD, which on Stellar <em>is</em> minting. This is what the deploy script did for tUSDT0 before locking the issuer.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn" onClick={() => void sandboxStep.run('gen')} disabled={sandboxStep.status === 'loading'}>{sandbox ? '✓ issuer generated + funded' : 'Generate + fund issuer'}</button>
                <button className="btn" onClick={() => void sandboxStep.run('sac')} disabled={!sandbox || !!sandbox.sac || !stellar.address || sandboxStep.status === 'loading'}>{sandbox?.sac ? '✓ SAC deployed' : 'Deploy SAC (you sign)'}</button>
                <button className="btn" onClick={() => void sandboxStep.run('trust')} disabled={!sandbox?.sac || sandbox.trust || sandboxStep.status === 'loading'}>{sandbox?.trust ? '✓ trustline' : 'Trustline (you sign)'}</button>
                <button className="btn" onClick={() => void sandboxStep.run('mint')} disabled={!sandbox?.trust || sandbox.minted || sandboxStep.status === 'loading'}>{sandbox?.minted ? '✓ minted 1,000 DIYUSD' : 'Issuer pays you = mint'}</button>
              </div>
              {sandbox ? <div className="mono mt-2 break-all text-muted">issuer {sandbox.issuer.publicKey()}{sandbox.sac ? ` · SAC ${sandbox.sac}` : ''}</div> : null}
              {sandboxStep.error ? <div className="mt-1 text-danger">{sandboxStep.error}</div> : null}
            </details>
          </div>
        </Section>
      </div>

      {/* Step 2 */}
      <Section title={<StepHeader n={2} title="Inspect the wiring" done={healthAllOk} />} subtitle="Deploying and wiring is a CLI script (8+ transactions on two chains); the browser reads the result.">
        <div className="grid gap-3 text-sm lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="font-semibold">set_peer</div>
            <p className="mt-1 text-xs text-muted">Each OApp stores the 32-byte address of its counterpart per EID. Stellar → EVM: the 20-byte address left-padded. EVM → Stellar: the raw contract id. No peer = <code>NoPeer</code> (2001) on send and <code>BLOCKED</code> on receive.</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="font-semibold">set_enforced_options</div>
            <p className="mt-1 text-xs text-muted">Type-3 options prepended to every send: the executor gas budget on the destination (200k towards EVM here; 500k “gas” towards Stellar, like the production adapter). ULN302 rejects empty options, so these are required.</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="font-semibold">endpoint.set_config</div>
            <p className="mt-1 text-xs text-muted">Per-OApp ULN config: <code>config_type 2</code> (send) and <code>3</code> (receive) with <code>required_dvns = [active DVN]</code>. Needed on testnet because the library defaults still name the deprecated DVN (send fails with #1213 otherwise).</p>
          </div>
        </div>
        <div className="mt-3">
          <RegistryCheck stage="testnet" compact />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Step 3 */}
        <Section title={<StepHeader n={3} title={`Send tUSDT0: Stellar → ${EVM.label}`} done={outTracker.messages[0]?.status.name === 'DELIVERED'} />}>
          <div className="space-y-2 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted">Amount (tUSDT0, 7 decimals)<input className="input mt-1 mono" value={amountOut} onChange={(e) => setAmountOut(e.target.value)} /></label>
              <label className="text-xs text-muted">Recipient on {EVM.label}<input className={`input mt-1 mono ${evmRecipient && !isEvmAddress(evmRecipient) ? 'border-danger' : ''}`} value={evmRecipient} onChange={(e) => setEvmRecipient(e.target.value.trim())} placeholder="0x… (defaults to your MetaMask)" /></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={!stellar.address || !outParam || !hasTrustline || quoteOut.status === 'loading' || !READY.wired} onClick={() => void quoteOut.run()}>{quoteOut.status === 'loading' ? 'quoting…' : '3a · quote_oft + quote_send'}</button>
              <button className="btn btn-primary" disabled={!outQuote || sendOut.status === 'loading' || stellar.wrongNetwork} onClick={() => void sendOut.run()}>{sendOut.status === 'loading' ? 'sign in wallet…' : '3b · send (Freighter signs)'}</button>
            </div>
            {outQuote ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <StatTile label="amount_sent_ld" value={formatUnits(outQuote.sent, 7)} sub="burned on Stellar" />
                <StatTile label="amount_received_ld" value={formatUnits(outQuote.received, 7)} sub={`minted on ${EVM.label} (6 dec) · used as min_amount_ld`} tone="ok" />
                <StatTile label="native_fee" value={`${formatUnits(outQuote.fee, 7)} XLM`} sub="paid to the endpoint inside send" />
              </div>
            ) : null}
            {quoteOut.error ? <div className="text-xs text-danger">{quoteOut.error}</div> : null}
            {sendOut.error ? <div className="text-xs text-danger">{sendOut.error}</div> : null}
            {outTx ? (
              <div className="space-y-2">
                <div className="text-xs text-muted">Source tx <a className="text-accent hover:underline" href={explorers.stellarTx('testnet', outTx)} target="_blank" rel="noreferrer">{outTx.slice(0, 16)}…</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${outTx}`}>open in Tracker</Link>{outTracker.loading ? ' · fetching…' : ''}</div>
                {outTracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry.data} compact />)}
                {outTracker.messages.length === 0 && !outTracker.error ? <Spinner label="waiting for LayerZero Scan to index the message (usually under a minute)…" /> : null}
                {outTracker.error ? <div className="text-xs text-muted">Scan: {outTracker.error} (retrying)</div> : null}
              </div>
            ) : null}
          </div>
        </Section>

        {/* Step 4 */}
        <Section title={<StepHeader n={4} title={`Send back: ${EVM.label} → Stellar`} done={backTracker.messages[0]?.status.name === 'DELIVERED'} />}>
          <div className="space-y-2 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted">Amount (tUSDT0, 6 decimals on EVM)<input className="input mt-1 mono" value={amountBack} onChange={(e) => setAmountBack(e.target.value)} /></label>
              <label className="text-xs text-muted">Stellar recipient (G…, needs a tUSDT0 trustline)<input className={`input mt-1 mono ${stRecipient && !isStellarAccount(stRecipient) ? 'border-danger' : ''}`} value={stRecipient} onChange={(e) => setStRecipient(e.target.value.trim())} /></label>
            </div>
            <p className="text-xs text-muted">The recipient goes on the wire as the 32-byte Ed25519 key of the G address (never the strkey string). On delivery the OFT checks for a contract with that id, finds none, and credits the account, which must already trust <code>tUSDT0</code> or execution fails.</p>
            <button className="btn btn-primary" disabled={!evm.walletClient || !READY.wired || sendBack.status === 'loading'} onClick={() => void sendBack.run()}>{sendBack.status === 'loading' ? 'confirm in MetaMask…' : 'quoteSend + send (MetaMask signs)'}</button>
            {sendBack.error ? <div className="text-xs text-danger">{sendBack.error}</div> : null}
            {backTx ? (
              <div className="space-y-2">
                <div className="text-xs text-muted">Source tx <a className="text-accent hover:underline" href={explorers.evmTx(EVM.explorer, backTx)} target="_blank" rel="noreferrer">{backTx.slice(0, 16)}…</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${backTx}`}>open in Tracker</Link></div>
                {backTracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry.data} compact />)}
                {backTracker.messages.length === 0 && !backTracker.error ? <Spinner label="waiting for Scan to index…" /> : null}
              </div>
            ) : null}
          </div>
        </Section>
      </div>

      <Section title="Console" subtitle="Every envelope and calldata this page produced, before and after signing.">
        <ConsolePanel entries={console_.entries} onClear={console_.clear} />
      </Section>

      <UnderTheHood
        items={[
          { title: 'Build the send', code: extractSnippet(oftSrc, 'prepareOftSend') + '\n\n' + extractSnippet(txSrc, 'prepareInvoke'), note: <p><code>from</code> is the transaction source, so <code>require_auth()</code> inside <code>send</code> (and the SAC <code>burn</code> and XLM transfer it triggers) is satisfied by the envelope signature. The simulation supplies the footprint and resource fee.</p> },
          { title: 'SendParam encoding', code: extractSnippet(oftSrc, 'sendParamScVal') },
          { title: 'Sign with the wallet', code: extractSnippet(walletSrc, 'walletsKitSign') + '\n\n' + extractSnippet(txSrc, 'submitAndPoll') },
          { title: 'Trustline', code: extractSnippet(classicSrc, 'changeTrust') },
          { title: 'EVM: quoteSend + send', code: extractSnippet(evmOftSrc, 'evmQuoteSend') },
          { title: 'Deploy script: upload + deploy', code: extractSnippet(deployNodeSrc, 'uploadWasm') + '\n\n' + extractSnippet(deployNodeSrc, 'deployContract') + '\n\n' + extractSnippet(deployNodeSrc, 'deploySac'), lang: 'ts', note: <p>From <code>scripts/lib/stellar-node.ts</code>, run by <code>scripts/deploy-testnet.ts</code>.</p> },
          { title: 'DVN override (set_config)', code: extractSnippet(endpointSrc, 'encodeOAppUlnConfig'), note: <p>The OAppUlnConfig struct is XDR-encoded and passed as <code>SetConfigParam.config</code> with <code>config_type</code> 2 (send) or 3 (receive).</p> },
          { title: 'Health check', code: extractSnippet(healthSrc, 'loadHealth'), live: health.data ? { data: health.data } : undefined },
        ]}
      />
    </div>
  );
}
