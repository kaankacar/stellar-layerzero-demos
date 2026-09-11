import { useCallback, useMemo, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import type { Address } from 'viem';
import { PageHeader } from '@/components/Shell';
import { AddressChip, Callout, ConsolePanel, Explainer, Section, UnderTheHood, useConsole } from '@/components/ui';
import { BridgePanel } from '@/components/BridgePanel';
import { EVM_TESTNETS, explorers } from '@/config/networks';
import { EVM_TESTNET_FALLBACK } from '@/config/layerzero.fallback';
import { TESTNET_DEPLOYMENT } from '@/config/testnet';
import { usePageNetworks, useWallets } from '@/lib/wallets/WalletProvider';
import { useAsyncAction, useLoader } from '@/lib/useLoader';
import { activeDvns, effectiveStellarDeployment, loadRegistry } from '@/lib/layerzero/chains';
import { useOftBridge } from '@/lib/oftBridge/useOftBridge';
import { CODE_RE, loadLaunch, newLaunch, saveLaunch, type LaunchState, type OftMode } from '@/lib/launchpad/state';
import { deployEvmOft, evmSetEnforced, evmSetPeer, handOffSacAdmin, lockIssuer, mintByPayment, oftArgs, prepareDeployFromWasm, prepareGrantMinter, prepareSetEnforced, prepareSetPeer, prepareUlnConfig, sacManagerArgs, WASM_HASHES } from '@/lib/launchpad/actions';
import { fundWithFriendbot } from '@/lib/stellar/friendbot';
import { prepareChangeTrust, prepareDeploySac } from '@/lib/stellar/classic';
import { submitAndPoll } from '@/lib/stellar/tx';
import { contractHexToStrkey, stellarAddressToHex } from '@/lib/stellar/strkey';
import { publicClient } from '@/lib/evm/clients';
import { extractSnippet } from '@/lib/snippets';
import actionsSrc from '@/lib/launchpad/actions.ts?raw';
import executeSrc from '@/lib/evm/execute.ts?raw';

const EVM_KEY = 'sepolia' as const;
const EVM = EVM_TESTNETS[EVM_KEY];

interface Step {
  id: string;
  title: string;
  who: 'Stellar wallet' | 'issuer key (browser)' | 'MetaMask' | 'Friendbot';
  done: boolean;
  skipped?: boolean;
  detail: string;
  run?: () => Promise<unknown>;
  enabled: boolean;
}

export function LaunchpadPage() {
  usePageNetworks({ stellar: 'testnet', evm: EVM_KEY });
  const { stellar, evm } = useWallets();
  const console_ = useConsole();
  const registry = useLoader((f) => loadRegistry(f), []);
  const live = effectiveStellarDeployment(registry.data, 'testnet');
  const activeDvn = useMemo(() => {
    const hex = activeDvns(registry.data, 'testnet')[0]?.id;
    try {
      return hex ? contractHexToStrkey(hex) : (TESTNET_DEPLOYMENT.registry?.activeDvn ?? '');
    } catch {
      return TESTNET_DEPLOYMENT.registry?.activeDvn ?? '';
    }
  }, [registry.data]);

  const [st, setSt] = useState<LaunchState | null>(() => loadLaunch());
  const update = useCallback((patch: Partial<LaunchState>) => {
    setSt((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveLaunch(next);
      return next;
    });
  }, []);
  const [form, setForm] = useState({ name: 'My Omni Token', code: 'OMNI', mode: 'LockUnlock' as OftMode, initialSupply: '1000000' });
  const codeOk = CODE_RE.test(form.code);

  const signSubmit = useCallback(
    async (label: string, unsignedXdr: string) => {
      console_.log('info', `${label}: unsigned envelope (XDR)`, undefined, unsignedXdr);
      const signed = await stellar.signTransaction(unsignedXdr);
      const res = await submitAndPoll('testnet', signed);
      console_.log('ok', `${label}: confirmed`, `tx ${res.hash}`, res.returnValue);
      return res;
    },
    [stellar, console_],
  );
  const owner = stellar.address;
  const issuerKp = st?.issuerSecret ? Keypair.fromSecret(st.issuerSecret) : null;

  const steps: Step[] = useMemo(() => {
    if (!st) return [];
    const ownerOk = !!owner && (!st.owner || st.owner === owner);
    const list: Step[] = [
      {
        id: 'issuer', title: 'Create and fund a throwaway issuer', who: 'Friendbot', done: !!st.issuerFunded, enabled: true,
        detail: 'A fresh Stellar keypair generated in your browser becomes the classic-asset issuer. Friendbot funds it. It is locked at the end, so it never needs to be kept safe; it is shown so you can inspect it.',
        run: async () => {
          const kp = Keypair.random();
          await fundWithFriendbot(kp.publicKey());
          console_.log('ok', `issuer ${kp.publicKey()} funded`);
          update({ issuerSecret: kp.secret(), issuer: kp.publicKey(), issuerFunded: true });
        },
      },
      {
        id: 'sac', title: `Deploy the SAC for ${st.code}:${st.issuer?.slice(0, 6) ?? '…'}`, who: 'Stellar wallet', done: !!st.sac, enabled: !!st.issuer && ownerOk,
        detail: 'createStellarAssetContract gives the classic asset its SEP-41 contract face. Anyone may deploy it; the id is deterministic.',
        run: async () => {
          const { tx, contractId } = await prepareDeploySac('testnet', owner!, st.code, st.issuer!);
          await signSubmit('createStellarAssetContract', tx.toXDR());
          update({ sac: contractId, owner: owner! });
        },
      },
      {
        id: 'manager', title: 'Deploy a SAC-manager (you are the owner)', who: 'Stellar wallet', done: !!st.sacManager, enabled: !!st.sac && ownerOk,
        detail: `createCustomContract from wasm ${WASM_HASHES.sacManager.slice(0, 12)}… (already uploaded on testnet) with (sac_token, owner = you). It will become the SAC's admin and gate minting with MINTER_ROLE.`,
        run: async () => {
          const tx = await prepareDeployFromWasm(owner!, WASM_HASHES.sacManager, sacManagerArgs(st.sac!, owner!));
          const res = await signSubmit('deploy SAC-manager', tx.toXDR());
          update({ sacManager: String(res.returnValue) });
        },
      },
      {
        id: 'trust', title: `Open your ${st.code} trustline`, who: 'Stellar wallet', done: !!st.trustline, enabled: !!st.sac && ownerOk,
        detail: 'Your account must trust the asset before it can hold any (also true for inbound bridge deliveries later).',
        run: async () => {
          const tx = await prepareChangeTrust('testnet', owner!, st.code, st.issuer!);
          await signSubmit('changeTrust', tx.toXDR());
          update({ trustline: true });
        },
      },
      {
        id: 'mint', title: `Mint ${Number(st.initialSupply).toLocaleString()} ${st.code} to you`, who: 'issuer key (browser)', done: !!st.minted, enabled: !!st.trustline && !!issuerKp,
        detail: 'A payment FROM the issuer is minting on Stellar. This is the last thing the issuer does before it hands over admin and gets locked.',
        run: async () => {
          const res = await mintByPayment(issuerKp!, owner!, st.code, st.initialSupply);
          console_.log('ok', `minted ${st.initialSupply} ${st.code} (tx ${res.hash})`);
          update({ minted: true });
        },
      },
      {
        id: 'admin', title: 'Hand the SAC admin to the SAC-manager', who: 'issuer key (browser)', done: !!st.adminHandedOff, enabled: !!st.sacManager && !!st.minted && !!issuerKp,
        detail: 'SAC.set_admin(sac_manager), signed by the current admin (the issuer). From now on only MINTER_ROLE holders can mint.',
        run: async () => {
          const res = await handOffSacAdmin(issuerKp!, st.sac!, st.sacManager!);
          console_.log('ok', `set_admin → SAC-manager (tx ${res.hash})`);
          update({ adminHandedOff: true });
        },
      },
      {
        id: 'oft', title: `Deploy the OFT (${st.mode})`, who: 'Stellar wallet', done: !!st.oft, enabled: !!st.adminHandedOff && ownerOk && !!live.endpointV2,
        detail: `createCustomContract from wasm ${WASM_HASHES.oft.slice(0, 12)}… with (token = SAC, shared_decimals = 6, oft_type = ${st.mode === 'MintBurn' ? 'MintBurn(sac_manager)' : 'LockUnlock'}, endpoint = ${live.endpointV2.slice(0, 8)}… from the registry, delegate = you).`,
        run: async () => {
          const tx = await prepareDeployFromWasm(owner!, WASM_HASHES.oft, oftArgs(st.sac!, st.mode, st.sacManager!, live.endpointV2, owner!));
          const res = await signSubmit('deploy OFT', tx.toXDR());
          const oft = String(res.returnValue);
          update({ oft, oftHex: stellarAddressToHex(oft) });
        },
      },
      {
        id: 'role', title: 'Grant MINTER_ROLE to the OFT', who: 'Stellar wallet', done: !!st.roleGranted || st.mode === 'LockUnlock', skipped: st.mode === 'LockUnlock', enabled: !!st.oft && ownerOk,
        detail: st.mode === 'MintBurn' ? 'MintBurn credits by calling sac_manager.mint(to, amount, operator = OFT), so the OFT contract id needs MINTER_ROLE.' : 'Not needed: a LockUnlock OFT never mints, it unlocks from its own reserve.',
        run: async () => {
          const tx = await prepareGrantMinter(owner!, st.sacManager!, st.oft!);
          await signSubmit('grant_role(OFT, MINTER_ROLE)', tx.unsignedXdr);
          update({ roleGranted: true });
        },
      },
      {
        id: 'lock', title: 'Lock the issuer (revocable + clawback flags, master weight 0)', who: 'issuer key (browser)', done: !!st.issuerLocked, enabled: !!st.adminHandedOff && !!issuerKp && (st.mode === 'LockUnlock' || !!st.roleGranted),
        detail: 'USDT0\'s trust model: with weight 0 the classic issuer can never mint again, so the role model on the SAC-manager is the only way to create supply.',
        run: async () => {
          const res = await lockIssuer(issuerKp!);
          console_.log('ok', `issuer locked (tx ${res.hash})`);
          update({ issuerLocked: true });
        },
      },
      {
        id: 'evm', title: `Deploy the ${EVM.label} OFT`, who: 'MetaMask', done: !!st.evmOft, enabled: !!st.oft && !!evm.walletClient && !evm.wrongNetwork,
        detail: `A plain LayerZero OFT (the contract is the ERC20) with 6 decimals: constructor(name, symbol, endpoint ${EVM_TESTNET_FALLBACK.sepolia.endpointV2.slice(0, 8)}…, delegate = you). Needs a little ${EVM.label} ETH.`,
        run: async () => {
          const { address, hash } = await deployEvmOft(evm.walletClient!, publicClient(EVM_KEY), st.name, st.code, EVM_TESTNET_FALLBACK.sepolia.endpointV2);
          console_.log('ok', `${EVM.label} OFT ${address} (tx ${hash})`);
          update({ evmOft: address, evmOwner: evm.address ?? undefined });
        },
      },
      {
        id: 'evmwire', title: `${EVM.label}: setPeer(40600) + setEnforcedOptions`, who: 'MetaMask', done: !!st.evmPeerSet && !!st.evmEnforcedSet, enabled: !!st.evmOft && !!st.oftHex && !!evm.walletClient && !evm.wrongNetwork,
        detail: 'The peer is the raw 32-byte Stellar contract id. Enforced options budget 500k gas for delivery on Stellar, like the production adapter.',
        run: async () => {
          const pub = publicClient(EVM_KEY);
          if (!st.evmPeerSet) {
            const h = await evmSetPeer(evm.walletClient!, pub, st.evmOft!, st.oftHex!);
            console_.log('ok', `setPeer ${h}`);
            update({ evmPeerSet: true });
          }
          const h2 = await evmSetEnforced(evm.walletClient!, pub, st.evmOft!);
          console_.log('ok', `setEnforcedOptions ${h2}`);
          update({ evmEnforcedSet: true });
        },
      },
      {
        id: 'stwire', title: 'Stellar: set_peer + set_enforced_options + endpoint.set_config', who: 'Stellar wallet', done: !!st.stellarPeerSet && !!st.stellarEnforcedSet && !!st.stellarConfigSet, enabled: !!st.evmOft && !!st.oft && ownerOk && !!activeDvn,
        detail: `Three wallet-signed transactions: peer = ${EVM.label} address left-padded to 32 bytes; enforced lzReceive gas 200k; per-OApp ULN config (send + receive) requiring the active testnet DVN ${activeDvn.slice(0, 8)}… (the library default names a deprecated one).`,
        run: async () => {
          if (!st.stellarPeerSet) {
            const p = await prepareSetPeer(owner!, st.oft!, EVM.eid, st.evmOft!);
            await signSubmit('set_peer', p.unsignedXdr);
            update({ stellarPeerSet: true });
          }
          if (!st.stellarEnforcedSet) {
            const p = await prepareSetEnforced(owner!, st.oft!, EVM.eid);
            await signSubmit('set_enforced_options', p.unsignedXdr);
            update({ stellarEnforcedSet: true });
          }
          const p = await prepareUlnConfig(owner!, live.endpointV2, st.oft!, live.sendUln302, EVM.eid, activeDvn);
          await signSubmit('endpoint.set_config (send + receive ULN)', p.unsignedXdr);
          update({ stellarConfigSet: true });
        },
      },
    ];
    return list;
  }, [st, owner, issuerKp, live, activeDvn, evm, signSubmit, update, console_]);

  const runStep = useAsyncAction(useCallback(async (id: string) => steps.find((s) => s.id === id)?.run?.(), [steps]));
  const [running, setRunning] = useState<string | null>(null);
  const allDone = steps.length > 0 && steps.every((s) => s.done);
  const bridgeCfg = allDone && st?.oft && st.sac && st.evmOft && st.issuer ? { stellar: { oft: st.oft, sac: st.sac, assetCode: st.code, issuer: st.issuer, faucet: null }, evm: { oft: st.evmOft as Address, chainKey: EVM_KEY, eid: EVM.eid }, defaults: { out: '100', back: '25' } } : null;
  const bridge = useOftBridge(bridgeCfg);

  return (
    <div className="space-y-6">
      <PageHeader title="Launch your own omnichain token" mode="testnet">
        A guided launch, signed by your own wallets: issue a classic asset on Stellar testnet, deploy its SAC, SAC-manager and OFT from the wasm this repo built, mint yourself the supply, lock the issuer, deploy the {EVM.label} side with MetaMask, and wire the two. About a dozen transactions, each explained before you sign it.
      </PageHeader>

      <Callout tone="testnet" title="Testnet only, and the issuer key lives in this browser">
        <p>The issuer keypair is generated here, kept in <code>localStorage</code> for the duration of the launch, and rendered useless at the end (master weight 0). Never do this with real value: production issuers are hardware-secured multisigs and the contracts are owned by a multisig like USDT0's OneSig. You will need testnet XLM (Friendbot) and a little {EVM.label} ETH in MetaMask.</p>
      </Callout>

      <Explainer id="launchpad">
        <p>
          This is the deploy script from the README, replayed in the browser with your wallets as the owner and delegate. The wasm for the SAC-manager and the OFT is already uploaded on testnet (hashes in <code>contracts/wasm/manifest.json</code>), so each contract is one <code>createCustomContract</code> transaction with constructor arguments. The order matters: the SAC admin can only be handed over by the issuer, minting by payment only works before the issuer is locked, and <code>MINTER_ROLE</code> must be granted by the SAC-manager's owner (you).
        </p>
        <p>
          Pick <strong>LockUnlock</strong> for a token whose home is Stellar (the OFT holds the reserve; {EVM.label} mints), or <strong>MintBurn</strong> to mirror USDT0 (both sides burn and mint; the OFT needs <code>MINTER_ROLE</code>). Everything after the launch is the same bridge flow as the other testnet pages.
        </p>
      </Explainer>

      {!st ? (
        <Section title="Design your token">
          <div className="grid gap-3 md:grid-cols-4 md:items-end">
            <label className="text-xs text-muted">Name<input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="text-xs text-muted">Asset code (1–12 alphanumeric)<input className={`input mt-1 mono ${codeOk ? '' : 'border-danger'}`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.trim() })} /></label>
            <label className="text-xs text-muted">OFT mode
              <select className="input mt-1" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as OftMode })}>
                <option value="LockUnlock">LockUnlock (home chain: Stellar)</option>
                <option value="MintBurn">MintBurn (like USDT0)</option>
              </select>
            </label>
            <label className="text-xs text-muted">Initial supply (to you)<input className="input mt-1 mono" value={form.initialSupply} onChange={(e) => setForm({ ...form, initialSupply: e.target.value.trim() })} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={!codeOk || !form.name.trim() || !/^\d+(\.\d{1,7})?$/.test(form.initialSupply)} onClick={() => { const s = newLaunch(form); saveLaunch(s); setSt(s); }}>Start the launch</button>
            {!stellar.address ? <button className="btn" onClick={() => void stellar.connect()}>Connect Stellar wallet</button> : null}
            {!evm.address ? <button className="btn" onClick={() => void evm.connect()}>Connect MetaMask</button> : null}
          </div>
        </Section>
      ) : (
        <>
          <Section
            title={`${st.name} (${st.code}) · ${st.mode}`}
            subtitle={`started ${new Date(st.createdAt).toLocaleString()} · ${steps.filter((s) => s.done).length}/${steps.length} steps`}
            right={
              <div className="flex flex-wrap gap-2 text-xs">
                <a className="btn px-2 py-1 text-xs" href={`data:application/json,${encodeURIComponent(JSON.stringify(st, null, 2))}`} download={`launch-${st.code}.json`}>export state</a>
                <button className="btn px-2 py-1 text-xs" onClick={() => { if (confirm('Forget this launch in the browser? Contracts already deployed stay on testnet.')) { saveLaunch(null); setSt(null); } }}>start over</button>
              </div>
            }
          >
            {st.owner && owner && st.owner !== owner ? <Callout tone="warn">This launch is owned by <code>{st.owner}</code>; connect that Stellar wallet to continue.</Callout> : null}
            <ol className="mt-2 space-y-2">
              {steps.map((s, i) => (
                <li key={s.id} className={`rounded-lg border p-3 ${s.done ? 'border-ok/40 bg-ok/5' : s.enabled ? 'border-border bg-surface-2' : 'border-border bg-surface-2 opacity-60'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${s.done ? 'bg-ok/20 text-ok' : 'bg-accent/20 text-accent'}`}>{s.done ? '✓' : i + 1}</span>
                        {s.title}
                        <span className="pill border-border text-muted">{s.who}</span>
                        {s.skipped ? <span className="pill border-border text-muted">skipped</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted">{s.detail}</p>
                    </div>
                    {!s.done ? (
                      <button className="btn btn-primary shrink-0" disabled={!s.enabled || running !== null} onClick={async () => { setRunning(s.id); await runStep.run(s.id); setRunning(null); }}>
                        {running === s.id ? 'signing…' : 'Run'}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            {runStep.error ? <Callout tone="danger">{runStep.error}</Callout> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {st.issuer ? <AddressChip label="issuer" address={st.issuer} href={explorers.stellarAccount('testnet', st.issuer)} /> : null}
              {st.sac ? <AddressChip label="SAC" address={st.sac} href={explorers.stellarContract('testnet', st.sac)} /> : null}
              {st.sacManager ? <AddressChip label="SAC-manager" address={st.sacManager} href={explorers.stellarContract('testnet', st.sacManager)} /> : null}
              {st.oft ? <AddressChip label={`OFT (${st.mode})`} address={st.oft} href={explorers.stellarContract('testnet', st.oft)} /> : null}
              {st.evmOft ? <AddressChip label={`${EVM.label} OFT`} address={st.evmOft} href={explorers.evmAddress(EVM.explorer, st.evmOft)} /> : null}
            </div>
            {st.issuerSecret && !st.issuerLocked ? (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">Throwaway issuer secret (testnet; becomes inert when locked)</summary>
                <code className="mono break-all">{st.issuerSecret}</code>
              </details>
            ) : null}
          </Section>

          {allDone && bridgeCfg ? (
            <>
              <Callout tone="ok" title={`${st.code} is live on two chains`}>
                <p>You own the Stellar OFT and the {EVM.label} OFT, they know each other as peers, and the pathway uses the active testnet DVN. Bridge it below, or paste your tx hashes into the Tracker. Recipients on Stellar need a {st.code} trustline.</p>
              </Callout>
              <BridgePanel bridge={bridge} assetCode={st.code} evmKey={EVM_KEY} registry={registry.data} faucetAmount={null} ready />
            </>
          ) : null}
        </>
      )}

      <Section title="Console"><ConsolePanel entries={[...console_.entries, ...bridge.console.entries].sort((a, b) => a.time - b.time)} onClear={() => { console_.clear(); bridge.console.clear(); }} /></Section>

      <UnderTheHood
        items={[
          { title: 'Deploy from a wasm hash', code: extractSnippet(actionsSrc, 'launchpadDeploy'), note: <p>The wallet signs a <code>createCustomContract</code> operation; the transaction's return value is the new contract address. Constructor arguments are plain ScVals.</p> },
          { title: 'Lock the issuer', code: extractSnippet(actionsSrc, 'lockIssuer') },
          { title: 'DVN override (set_config)', code: extractSnippet(actionsSrc, 'launchpadSetConfig') },
          { title: 'EVM side with MetaMask', code: extractSnippet(actionsSrc, 'launchpadEvm') },
          { title: 'Deliver a message yourself', code: extractSnippet(executeSrc, 'executionState') + '\n\n' + extractSnippet(executeSrc, 'deliverYourself'), note: <p>Execution is permissionless: after the DVN attests, anyone can commit the verification and call <code>lzReceive</code>. The Tracker shows this button for your testnet messages.</p> },
        ]}
      />
    </div>
  );
}
