import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StrKey } from '@stellar/stellar-sdk';
import type { Hex } from 'viem';
import { PageHeader } from '@/components/Shell';
import { AddressChip, Callout, ConsolePanel, DataStatus, Explainer, Section, Spinner, StatTile, UnderTheHood, useConsole } from '@/components/ui';
import { Lifecycle } from '@/components/Lifecycle';
import { EVM_TESTNETS, explorers } from '@/config/networks';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { deploymentReady, MOCK_ASSET_CODE, TESTNET_DEPLOYMENT } from '@/config/testnet';
import { usePageNetworks, useWallets } from '@/lib/wallets/WalletProvider';
import { useAsyncAction, useLoader, toLoaded } from '@/lib/useLoader';
import { loadRegistry } from '@/lib/layerzero/chains';
import { decodeOptions, describeOption } from '@/lib/layerzero/options';
import { useMessageTracker } from '@/lib/layerzero/useMessageTracker';
import { publicClient } from '@/lib/evm/clients';
import { evmBalanceOf } from '@/lib/evm/oft';
import {
  COMPOSE_GAS,
  MAX_NOTE_BYTES,
  composeQueued,
  depositParam,
  ensureFunded,
  evmFaucet,
  findComposeSent,
  loadVault,
  prepareLzCompose,
  prepareWithdraw,
  quoteDeposit,
  relayerKeypair,
  sendDeposit,
  signDigest,
  submitWithKeypair,
  utf8,
  withdrawDigest,
  type VaultState,
} from '@/lib/compose/compose';
import { formatTimestamp, formatUnits, parseUnits, timeAgo, truncate } from '@/lib/format';
import { extractSnippet } from '@/lib/snippets';
import composeSrc from '@/lib/compose/compose.ts?raw';
import optionsSrc from '@/lib/layerzero/options.ts?raw';
import rustSrc from '../../contracts/stellar/composer-vault/src/lib.rs?raw';
import solSrc from '../../contracts/evm/src/TestOFT.sol?raw';

const D = TESTNET_DEPLOYMENT;
const EVM_KEY = D.evm?.chainKey ?? 'arbitrum-sepolia';
const EVM = EVM_TESTNETS[EVM_KEY];
const VAULT = D.stellar?.composer ?? null;
const OFT = D.stellar?.oft ?? null;
const SAC = D.stellar?.sac ?? null;
const ENDPOINT = D.registry?.endpoint ?? STELLAR_FALLBACK.testnet.endpointV2;
const READY = deploymentReady(D).wired && !!VAULT;
const EMPTY: VaultState = { count: 0, held: 0n, deposits: [], balance: null, nonce: null };

export function ComposePage() {
  usePageNetworks({ stellar: 'testnet', evm: EVM_KEY });
  const { evm } = useWallets();
  const console_ = useConsole();
  const registry = useLoader((f) => loadRegistry(f), []);
  const relayer = useMemo(() => relayerKeypair(), []);
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const vault = useLoader(() => toLoaded(VAULT && SAC ? loadVault('testnet', VAULT, SAC, evm.address) : Promise.resolve(EMPTY)), [tick, evm.address]);
  const evmBal = useLoader(() => toLoaded(evm.address && D.evm?.oft ? evmBalanceOf(publicClient(EVM_KEY), D.evm.oft, evm.address) : Promise.resolve(null)), [tick, evm.address]);
  useEffect(() => {
    const t = setInterval(bump, 30_000);
    return () => clearInterval(t);
  }, []);

  // ---- deposit ----
  const [amount, setAmount] = useState('5');
  const [note, setNote] = useState('hello from MetaMask');
  const noteBytes = utf8.encode(note).length;
  const [txHash, setTxHash] = useState<string | null>(null);
  const tracker = useMessageTracker('testnet', txHash);
  const delivered = tracker.messages[0]?.status.name === 'DELIVERED' ? tracker.messages[0] : null;
  const [composeState, setComposeState] = useState<'unknown' | 'queued' | 'done'>('unknown');

  const faucet = useAsyncAction(
    useCallback(async () => {
      if (!evm.walletClient || !D.evm?.oft) throw new Error('connect MetaMask');
      if (evm.wrongNetwork) throw new Error(`switch MetaMask to ${EVM.label}`);
      const hash = await evmFaucet(evm.walletClient, D.evm.oft);
      console_.log('info', `faucet() submitted ${hash}`);
      await publicClient(EVM_KEY).waitForTransactionReceipt({ hash });
      console_.log('ok', `1,000 ${MOCK_ASSET_CODE} minted on ${EVM.label}`);
      bump();
      return hash;
    }, [evm, console_]),
  );

  const deposit = useAsyncAction(
    useCallback(async () => {
      if (!evm.walletClient || !evm.address || !D.evm?.oft || !VAULT) throw new Error('connect MetaMask');
      if (evm.wrongNetwork) throw new Error(`switch MetaMask to ${EVM.label}`);
      if (noteBytes > MAX_NOTE_BYTES) throw new Error(`note is ${noteBytes} bytes; max ${MAX_NOTE_BYTES}`);
      const amount6 = parseUnits(amount || '0', 6);
      if (amount6 <= 0n) throw new Error('amount must be positive');
      const p = depositParam(VAULT, amount6, note);
      console_.log('info', `SendParam: to = vault ${truncate(VAULT, 8, 6)} as bytes32, composeMsg = ${noteBytes} bytes, options: ${decodeOptions(p.extraOptions!).options.map(describeOption).join(', ')}`, undefined, { ...p, amountLD: p.amountLD.toString(), minAmountLD: '0' });
      const fee = await quoteDeposit(publicClient(EVM_KEY), D.evm.oft, p);
      console_.log('info', `quoteSend → nativeFee ${fee.nativeFee} wei (lz_receive on the OFT plus lz_compose on the vault, ${COMPOSE_GAS} each)`);
      const hash = await sendDeposit(evm.walletClient, D.evm.oft, p, fee.nativeFee, evm.address);
      console_.log('ok', `MetaMask submitted ${hash}`);
      setComposeState('unknown');
      setTxHash(hash);
      return hash;
    }, [evm, amount, note, noteBytes, console_]),
  );

  // Once the OFT delivered on Stellar, the compose message sits on the endpoint until lz_compose runs.
  const deliveredGuid = delivered?.guid;
  useEffect(() => {
    if (!deliveredGuid || !VAULT || !OFT) return;
    let stop = false;
    const check = async () => {
      const queued = await composeQueued('testnet', ENDPOINT, OFT, VAULT, deliveredGuid as Hex).catch(() => null);
      if (stop || queued === null) return;
      setComposeState((prev) => {
        if (!queued && prev !== 'done') bump();
        return queued ? 'queued' : 'done';
      });
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [deliveredGuid]);

  const executeCompose = useAsyncAction(
    useCallback(async () => {
      const dst = delivered?.destination.tx?.txHash?.replace(/^0x/, '');
      if (!delivered || !dst || !VAULT || !OFT) throw new Error('no delivered message yet');
      const found = await findComposeSent('testnet', ENDPOINT, VAULT, delivered.guid as Hex, dst);
      if (!found) throw new Error('no ComposeSent event for this GUID in the delivery transaction');
      console_.log('info', `ComposeSent payload, ${(found.message.length - 2) / 2} bytes: [nonce][src_eid][amount_ld][compose_from][note]`, undefined, found.message);
      const funded = await ensureFunded('testnet', relayer.publicKey());
      if (funded === 'funded') console_.log('info', `Friendbot funded the fee payer ${relayer.publicKey()}`);
      const prepared = await prepareLzCompose('testnet', relayer.publicKey(), VAULT, OFT, delivered.guid as Hex, found.message);
      console_.log('info', 'lz_compose: unsigned envelope (simulation passed, so clear_compose accepted the payload)', undefined, prepared.unsignedXdr);
      const res = await submitWithKeypair('testnet', prepared, relayer);
      console_.log('ok', `lz_compose executed by you: ${res.hash}`);
      setComposeState('done');
      bump();
      return res.hash;
    }, [delivered, relayer, console_]),
  );

  // ---- withdraw ----
  const [wdAmount, setWdAmount] = useState('2');
  const [wdTo, setWdTo] = useState('');
  const [wdTx, setWdTx] = useState<string | null>(null);
  const withdraw = useAsyncAction(
    useCallback(async () => {
      if (!evm.walletClient || !evm.address || !VAULT) throw new Error('connect MetaMask');
      const to = wdTo.trim();
      if (!StrKey.isValidEd25519PublicKey(to) && !StrKey.isValidContract(to)) throw new Error(`destination must be a G… account (with a ${MOCK_ASSET_CODE} trustline) or a C… contract`);
      const amount7 = parseUnits(wdAmount || '0', 7);
      if (amount7 <= 0n) throw new Error('amount must be positive');
      const digest = await withdrawDigest('testnet', VAULT, evm.address, to, amount7);
      console_.log('info', `withdraw_digest(evm, to, ${amount7}) with nonce ${vault.data?.nonce ?? '?'} → ${digest}`);
      const sig = await signDigest(evm.walletClient, digest);
      console_.log('ok', `MetaMask personal_sign → ${sig}`);
      const funded = await ensureFunded('testnet', relayer.publicKey());
      if (funded === 'funded') console_.log('info', `Friendbot funded the fee payer ${relayer.publicKey()}`);
      const prepared = await prepareWithdraw('testnet', relayer.publicKey(), VAULT, evm.address, to, amount7, sig);
      console_.log('info', 'withdraw: unsigned envelope (simulation passed: secp256k1_recover matched your address)', undefined, prepared.unsignedXdr);
      const res = await submitWithKeypair('testnet', prepared, relayer);
      console_.log('ok', `withdraw submitted ${res.hash}`);
      setWdTx(res.hash);
      bump();
      return res.hash;
    }, [evm, wdTo, wdAmount, vault.data?.nonce, relayer, console_]),
  );

  const v = vault.data ?? EMPTY;

  return (
    <div className="space-y-6">
      <PageHeader title="Compose: MetaMask drives a Soroban vault" mode="testnet">
        A Stellar application whose users never touch a Stellar wallet. MetaMask on {EVM.label} sends {MOCK_ASSET_CODE} to a Soroban contract with a <em>composed message</em>; the contract credits the sender's EVM address. The same key later withdraws with a signature that the contract verifies on Stellar.
      </PageHeader>

      <Explainer id="compose">
        <p>
          <strong>Deposit.</strong> An OFT transfer can carry a payload. On {EVM.label} the send names the vault's 32-byte contract id as <code>to</code>, adds an <code>lzCompose</code> executor option and puts a note in <code>composeMsg</code>. On Stellar the OFT mints the tokens to the vault (a contract can hold a SAC balance), then calls the endpoint's <code>send_compose</code>. The executor calls <code>lz_compose</code> on the vault, which asks the endpoint to <code>clear_compose</code> the exact payload (only the OFT could have queued it, and only once), decodes the standard OFT compose header, and credits <code>amount_ld</code> to the 20-byte address in <code>compose_from</code>.
        </p>
        <p>
          <strong>Withdraw.</strong> The vault exposes <code>withdraw_digest(evm, to, amount)</code>: a keccak256 over a domain string, the contract, the address, its nonce, the amount and the destination. MetaMask signs it with <code>personal_sign</code>. <code>withdraw</code> re-derives the digest, applies the EIP-191 prefix, recovers the signer with Soroban's <code>secp256k1_recover</code> host function and compares the last 20 bytes of the keccak256 of the public key with the EVM address. Whoever submits pays the Stellar fee; here a throwaway key from this browser does.
        </p>
        <p>
          Nothing here needs the executor's permission: <code>lz_compose</code> is callable by anyone once the compose is queued, so the page can finish a slow delivery itself, the same way the Tracker offers to run <code>lz_receive</code>.
        </p>
      </Explainer>

      <Callout tone="testnet" title="Testnet demo, no real funds">
        <p>{MOCK_ASSET_CODE} is a mock. You need a little {EVM.label} ETH in MetaMask for the two transactions; the LayerZero fee is paid in ETH and quoted before you sign. The Stellar fee payer is a Friendbot-funded key that holds no tokens.</p>
      </Callout>

      {!READY ? (
        <Callout tone="warn" title="Vault not deployed yet">
          <p>Run pnpm build:wasm and pnpm deploy:testnet to deploy the ComposerVault on Stellar testnet and the OFT on {EVM.label}. Deposits are disabled until then.</p>
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Deposit from MetaMask" subtitle={`${EVM.label} → Stellar testnet, one MetaMask transaction`}>
          {!evm.walletClient ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Connect MetaMask on {EVM.label} to begin.</span>
              <button className="btn btn-primary" onClick={() => void evm.connect()}>Connect MetaMask</button>
            </div>
          ) : evm.wrongNetwork ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-warn">MetaMask is on another network.</span>
              <button className="btn" onClick={() => void evm.switchToExpected()}>Switch to {EVM.label}</button>
            </div>
          ) : null}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Your {MOCK_ASSET_CODE} on {EVM.label}: <span className="mono">{evmBal.data !== null && evmBal.data !== undefined ? formatUnits(evmBal.data, 6, 2) : '—'}</span>
            </span>
            <button className="btn" disabled={!evm.walletClient || faucet.status === 'loading'} onClick={() => void faucet.run()}>
              {faucet.status === 'loading' ? 'minting…' : `Faucet: 1,000 ${MOCK_ASSET_CODE}`}
            </button>
          </div>
          {faucet.error ? <div className="mb-2 text-xs text-danger">{faucet.error}</div> : null}
          <label className="block text-xs text-muted">Amount ({MOCK_ASSET_CODE}, 6 decimals on {EVM.label})</label>
          <input className="input mono mt-1 w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="mt-3 block text-xs text-muted">Note (composeMsg, {noteBytes} / {MAX_NOTE_BYTES} bytes)</label>
          <input className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={!READY || !evm.walletClient || deposit.status === 'loading' || noteBytes > MAX_NOTE_BYTES} onClick={() => void deposit.run()}>
              {deposit.status === 'loading' ? 'sign in MetaMask…' : 'Deposit via LayerZero'}
            </button>
            {deposit.error ? <span className="text-xs text-danger">{deposit.error}</span> : null}
          </div>
          {txHash ? (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-muted">
                Source tx <a className="text-accent hover:underline" href={explorers.evmTx(EVM.explorer, txHash)} target="_blank" rel="noreferrer">{truncate(txHash, 12, 8)}</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${txHash}`}>open in Tracker</Link>
              </div>
              {tracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry.data} compact />)}
              {tracker.messages.length === 0 ? <Spinner label="waiting for LayerZero Scan to index…" /> : null}
              {delivered ? (
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
                  {composeState === 'done' ? (
                    <span className="text-ok">lz_compose executed: the vault credited your EVM address. Balance below.</span>
                  ) : composeState === 'queued' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-warn">Tokens delivered; the compose message is still queued on the endpoint (waiting for the executor).</span>
                      <button className="btn" disabled={executeCompose.status === 'loading'} onClick={() => void executeCompose.run()}>
                        {executeCompose.status === 'loading' ? 'executing…' : 'Execute lz_compose yourself'}
                      </button>
                      {executeCompose.error ? <span className="text-xs text-danger">{executeCompose.error}</span> : null}
                    </div>
                  ) : (
                    <Spinner label="checking the endpoint's compose queue…" />
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section title="The vault on Stellar" subtitle="Read live from the contract by simulation" right={<DataStatus state={vault} reload={bump} />}>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label={`${MOCK_ASSET_CODE} held by the vault`} value={formatUnits(v.held, 7, 2)} sub="SAC balance of the contract" />
            <StatTile label="Deposits credited" value={v.count} sub="lz_compose calls" />
            <StatTile label="Your balance" value={v.balance !== null ? formatUnits(v.balance, 7, 2) : '—'} sub={evm.address ? truncate(evm.address, 8, 6) : 'connect MetaMask'} tone={v.balance ? 'ok' : undefined} />
            <StatTile label="Your withdrawal nonce" value={v.nonce !== null ? v.nonce : '—'} sub="goes into every digest" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {VAULT ? <AddressChip label="ComposerVault" address={VAULT} href={explorers.stellarContract('testnet', VAULT)} /> : null}
            {OFT ? <AddressChip label="Stellar OFT" address={OFT} href={explorers.stellarContract('testnet', OFT)} /> : null}
            {D.evm?.oft ? <AddressChip label={`${EVM.label} OFT`} address={D.evm.oft} href={explorers.evmAddress(EVM.explorer, D.evm.oft)} /> : null}
          </div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Recent deposits</div>
          {v.deposits.length === 0 ? <div className="mt-1 text-sm text-muted">None yet. Be the first.</div> : null}
          <ul className="mt-1 divide-y divide-border text-sm">
            {v.deposits.map((d) => (
              <li key={d.guid} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="mono text-xs">
                  <a className="text-accent hover:underline" href={explorers.evmAddress(EVM.explorer, d.from)} target="_blank" rel="noreferrer">{truncate(d.from, 8, 6)}</a>
                </span>
                <span className="mono">+{formatUnits(d.amount, 7, 2)}</span>
                <span className="flex-1 truncate text-muted">{d.note || <em>no note</em>}</span>
                <span className="text-xs text-muted" title={formatTimestamp(d.timestamp)}>{timeAgo(d.timestamp)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Withdraw with a MetaMask signature" subtitle="No Stellar wallet: MetaMask signs a digest, a throwaway key submits">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <div>
            <label className="block text-xs text-muted">Destination on Stellar (G… with a {MOCK_ASSET_CODE} trustline, or a C… contract)</label>
            <input className="input mono mt-1 w-full" placeholder="G… or C…" value={wdTo} onChange={(e) => setWdTo(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted">Amount ({MOCK_ASSET_CODE}, 7 decimals on Stellar)</label>
            <input className="input mono mt-1 w-full" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary" disabled={!READY || !evm.walletClient || withdraw.status === 'loading' || !v.balance} onClick={() => void withdraw.run()}>
              {withdraw.status === 'loading' ? 'sign in MetaMask…' : 'Sign and withdraw'}
            </button>
          </div>
        </div>
        {withdraw.error ? <div className="mt-2 text-xs text-danger">{withdraw.error}</div> : null}
        {wdTx ? (
          <div className="mt-2 text-xs text-muted">
            Stellar tx <a className="text-accent hover:underline" href={explorers.stellarTx('testnet', wdTx)} target="_blank" rel="noreferrer">{truncate(wdTx, 12, 8)}</a>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Fee payer (this browser, Friendbot-funded, holds nothing):</span>
          <AddressChip label="relayer" address={relayer.publicKey()} href={explorers.stellarAccount('testnet', relayer.publicKey())} />
        </div>
      </Section>

      <Section title="Console"><ConsolePanel entries={console_.entries} onClear={console_.clear} /></Section>

      <UnderTheHood
        items={[
          { title: 'Vault (Rust): lz_compose', code: extractSnippet(rustSrc, 'lzComposeRust'), lang: 'rust', note: <p>The endpoint's <code>clear_compose</code> is the authenticity check: it only clears a payload the OFT queued for this contract, once.</p> },
          { title: 'Vault (Rust): withdraw', code: extractSnippet(rustSrc, 'withdrawRust'), lang: 'rust', note: <p>EIP-191 prefix, <code>secp256k1_recover</code>, keccak256 of the public key: the EVM address is the account.</p> },
          { title: 'Browser: deposit (SendParam + lzCompose option)', code: extractSnippet(composeSrc, 'composeDeposit') + '\n\n' + extractSnippet(optionsSrc, 'encodeLzComposeOption') },
          { title: 'Browser: withdraw flow', code: extractSnippet(composeSrc, 'withdrawFlow') + '\n\n' + extractSnippet(composeSrc, 'relayer') },
          { title: 'Browser: execute the compose yourself', code: extractSnippet(composeSrc, 'composeFallback') },
          { title: 'Browser: reading the vault', code: extractSnippet(composeSrc, 'vaultReads') },
          { title: 'EVM faucet (Solidity)', code: extractSnippet(solSrc, 'evmFaucetSol'), lang: 'solidity' },
        ]}
      />
    </div>
  );
}
