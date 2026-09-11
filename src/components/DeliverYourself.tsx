import { useCallback, useState } from 'react';
import type { Address } from 'viem';
import { EVM_TESTNET_FALLBACK } from '@/config/layerzero.fallback';
import { EVM_TESTNETS } from '@/config/networks';
import type { ScanMessage } from '@/lib/layerzero/scan';
import { isStellarEid } from '@/lib/layerzero/scan';
import { findPacketSent } from '@/lib/stellar/packetEvents';
import { commitVerification, dvnVerified, executionState, lzReceive, planFromPacket } from '@/lib/evm/execute';
import { publicClient } from '@/lib/evm/clients';
import { useWallets } from '@/lib/wallets/WalletProvider';
import { useAsyncAction } from '@/lib/useLoader';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { findPacketSentEvm, prepareCommitVerification, prepareLzReceive, stellarInboundState, ulnVerifiable } from '@/lib/stellar/deliver';
import { bytes32ToStellarCandidates } from '@/lib/stellar/strkey';
import { contractExists } from '@/lib/stellar/simulate';
import { submitAndPoll } from '@/lib/stellar/tx';

/**
 * "Deliver it yourself": once the DVN has attested, anyone can commit the
 * verification and call lzReceive on the EVM destination. Shown for
 * Stellar-testnet -> EVM-testnet messages that are not delivered yet.
 */
export function DeliverYourself({ message: m, sourceTxHash }: { message: ScanMessage; sourceTxHash?: string }) {
  const { evm, stellar } = useWallets();
  const [log, setLog] = useState<string[]>([]);
  const dst = Object.values(EVM_TESTNETS).find((c) => c.eid === m.pathway.dstEid);
  const fb = dst ? EVM_TESTNET_FALLBACK[dst.key] : undefined;
  const srcTx = sourceTxHash ?? m.source.tx?.txHash;
  const toEvm = !!dst && !!fb && isStellarEid(m.pathway.srcEid) && m.pathway.srcEid === 40600 && m.status.name !== 'DELIVERED' && !!srcTx;
  const srcEvm = Object.values(EVM_TESTNETS).find((c) => c.eid === m.pathway.srcEid);
  const toStellar = !!srcEvm && m.pathway.dstEid === 40600 && m.status.name !== 'DELIVERED' && !!srcTx;
  const applicable = toEvm || toStellar;

  const runStellar = useAsyncAction(
    useCallback(async () => {
      if (!srcEvm || !srcTx) throw new Error('not applicable');
      if (!stellar.address) throw new Error('connect a Stellar wallet (testnet)');
      if (stellar.wrongNetwork) throw new Error('switch your wallet to Test Net');
      const say = (s: string) => setLog((l) => [...l, s]);
      const packet = await findPacketSentEvm(publicClient(srcEvm.key), srcTx as `0x${string}`);
      if (!packet) throw new Error('no PacketSent event in the source transaction');
      const c = bytes32ToStellarCandidates(packet.receiver);
      const receiver = (await contractExists('testnet', c.contract)) ? c.contract : c.account;
      const { endpointV2, receiveUln302 } = STELLAR_FALLBACK.testnet;
      let state = await stellarInboundState('testnet', endpointV2, receiver, packet);
      say(`endpoint state: ${state}`);
      if (state === 'Executed') return 'already executed';
      if (state === 'NotVerified') {
        if (!(await ulnVerifiable('testnet', receiveUln302, packet))) throw new Error('the DVN has not attested on Stellar yet; wait, then retry');
        const p = await prepareCommitVerification('testnet', stellar.address, receiveUln302, packet);
        const r = await submitAndPoll('testnet', await stellar.signTransaction(p.unsignedXdr));
        say(`commit_verification ${r.hash}`);
        state = await stellarInboundState('testnet', endpointV2, receiver, packet);
      }
      if (state !== 'Verified') throw new Error(`state ${state}`);
      const p = await prepareLzReceive('testnet', stellar.address, receiver, packet);
      const r = await submitAndPoll('testnet', await stellar.signTransaction(p.unsignedXdr));
      say(`lz_receive ${r.hash} (you were the executor)`);
      return r.hash;
    }, [srcEvm, srcTx, stellar]),
  );

  const run = useAsyncAction(
    useCallback(async () => {
      if (!dst || !fb || !srcTx) throw new Error('not applicable');
      if (!evm.walletClient) throw new Error('connect MetaMask');
      if (evm.chainId !== dst.chainId) throw new Error(`switch MetaMask to ${dst.label}`);
      const say = (s: string) => setLog((l) => [...l, s]);
      const packet = await findPacketSent('testnet', srcTx);
      if (!packet) throw new Error('no packet_sent event in the source transaction');
      const plan = planFromPacket(packet);
      const pub = publicClient(dst.key);
      let state = await executionState(pub, fb.endpointV2, plan);
      say(`endpoint state: ${state}`);
      if (state === 'Executed') return 'already executed';
      if (state === 'NotExecutable') {
        const ok = await dvnVerified(pub, fb.receiveUln302, plan);
        if (!ok) throw new Error('the DVN has not attested yet; wait for the DVN lane to turn green, then retry');
        say('DVN attestation present; committing verification…');
        const h = await commitVerification(evm.walletClient, fb.receiveUln302 as Address, plan);
        await pub.waitForTransactionReceipt({ hash: h });
        say(`commitVerification ${h}`);
        state = await executionState(pub, fb.endpointV2, plan);
      }
      if (state !== 'Executable') throw new Error(`state ${state}: an earlier nonce is still pending`);
      say('calling lzReceive…');
      const h2 = await lzReceive(evm.walletClient, fb.endpointV2 as Address, plan);
      const rc = await pub.waitForTransactionReceipt({ hash: h2 });
      say(`lzReceive ${h2} (${rc.status})`);
      return h2;
    }, [dst, fb, srcTx, evm]),
  );

  if (!applicable) return null;
  const action = toEvm ? run : runStellar;
  return (
    <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs">
      <div className="mb-1 font-semibold text-text">Deliver it yourself (execution is permissionless)</div>
      <p className="text-muted">
        {toEvm ? (
          <>After every required DVN has attested, anyone may finish the job: <code>ReceiveUln302.commitVerification(header, payloadHash)</code> then <code>EndpointV2.lzReceive(origin, receiver, guid, message)</code>. The executor is a convenience. On testnets it can lag by an hour, so here is the button. Costs a normal {dst?.label} transaction.</>
        ) : (
          <>On Stellar, <code>lz_receive(executor, …)</code> only asks the <em>given</em> executor address to authorize, so you can be the executor: <code>ULN302.commit_verification(header, payload_hash)</code> if needed, then the OApp's <code>lz_receive</code> with your address, both signed by your Stellar wallet. Costs two small XLM fees.</>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={action.status === 'loading' || (toEvm ? !evm.walletClient : !stellar.address)} onClick={() => void action.run()}>
          {action.status === 'loading' ? (toEvm ? 'confirm in MetaMask…' : 'sign in your Stellar wallet…') : toEvm ? (evm.walletClient ? 'commitVerification + lzReceive' : 'connect MetaMask to deliver') : stellar.address ? 'commit_verification + lz_receive' : 'connect a Stellar wallet to deliver'}
        </button>
        {action.error ? <span className="text-danger">{action.error}</span> : null}
        {action.status === 'done' ? <span className="text-ok">done: {String(action.value).slice(0, 18)}…</span> : null}
      </div>
      {log.length ? <ul className="mono mt-2 space-y-0.5 text-muted">{log.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
    </div>
  );
}
