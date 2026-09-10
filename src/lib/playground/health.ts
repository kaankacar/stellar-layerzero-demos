/**
 * Deployment health: is the testnet deployment this build knows about still
 * wired to the endpoint the registry lists today? Testnet has been redeployed
 * before, so the UI shows this before letting anyone send.
 */
import type { Address } from 'viem';
import { TESTNET_DEPLOYMENT, type TestnetDeployment } from '@/config/testnet';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { effectiveStellarDeployment, type RegistrySnapshot } from '@/lib/layerzero/chains';
import { getEnforcedOptions, getOftFacts, getPeer } from '@/lib/stellar/oft';
import { effectiveReceiveUlnConfig, effectiveSendUlnConfig } from '@/lib/stellar/uln';
import { readContract } from '@/lib/stellar/simulate';
import { sc } from '@/lib/stellar/scval';
import { publicClient } from '@/lib/evm/clients';
import { evmEnforcedOptions, evmPeer } from '@/lib/evm/oft';
import { bytesToHex, evmAddressToBytes32 } from '@/lib/hex';

export interface HealthCheck {
  label: string;
  ok: boolean | null;
  detail: string;
}

// snippet:start loadHealth
export async function loadHealth(registry: RegistrySnapshot | null, dep: TestnetDeployment = TESTNET_DEPLOYMENT): Promise<HealthCheck[]> {
  const S = dep.stellar;
  const E = dep.evm;
  if (!S?.oft || !S.sac || !S.sacManager) return [{ label: 'Stellar side deployed', ok: false, detail: 'run pnpm build:wasm && pnpm deploy:testnet' }];
  const live = effectiveStellarDeployment(registry, 'testnet');
  const activeDvn = dep.registry?.activeDvn ?? Object.values(STELLAR_FALLBACK.testnet.dvns).find((d) => !d.deprecated)?.strkey ?? '';
  const checks: HealthCheck[] = [];
  const oft = await getOftFacts('testnet', S.oft);
  checks.push({ label: 'OFT.endpoint() == registry endpoint', ok: oft.endpoint === live.endpointV2, detail: oft.endpoint === live.endpointV2 ? live.endpointV2 : `OFT points at ${oft.endpoint}, registry says ${live.endpointV2}: the testnet was redeployed, re-run the deploy script` });
  checks.push({ label: 'OFT.token() == mock SAC, MintBurn via SAC-manager', ok: oft.token === S.sac && oft.oftType.minter === S.sacManager, detail: `${oft.oftType.variant}(${oft.oftType.minter ?? '-'})` });
  const admin = await readContract<string>('testnet', S.sac, 'admin').catch(() => null);
  checks.push({ label: 'SAC.admin() == SAC-manager', ok: admin === S.sacManager, detail: admin ?? 'unreadable' });
  const role = await readContract<number | null | undefined>('testnet', S.sacManager, 'has_role', [sc.address(S.oft), sc.symbol('MINTER_ROLE')]).catch(() => null);
  checks.push({ label: 'OFT holds MINTER_ROLE on the SAC-manager', ok: role !== null && role !== undefined, detail: role !== null && role !== undefined ? 'granted' : 'missing' });
  if (E?.oft) {
    const peer = await getPeer('testnet', S.oft, E.eid);
    const want = bytesToHex(evmAddressToBytes32(E.oft));
    checks.push({ label: `Stellar OFT.peer(${E.eid}) == EVM TestOFT`, ok: peer?.toLowerCase() === want.toLowerCase(), detail: peer ?? 'not set' });
    const enforced = await getEnforcedOptions('testnet', S.oft, E.eid, 1);
    checks.push({ label: 'Stellar enforced options set (lzReceive gas for EVM)', ok: !!enforced, detail: enforced ?? 'none' });
    const send = await effectiveSendUlnConfig('testnet', live.sendUln302, S.oft, E.eid);
    const okSend = send.requiredDvns.length === 1 && send.requiredDvns[0] === activeDvn;
    checks.push({ label: 'Send ULN config requires the active DVN', ok: okSend, detail: `${send.requiredDvns.join(', ')} (${send.confirmations.toString()} conf)` + (okSend ? '' : ' — the library default still names a deprecated DVN; the deploy script overrides it') });
    const recv = await effectiveReceiveUlnConfig('testnet', live.receiveUln302, S.oft, E.eid);
    checks.push({ label: 'Receive ULN config requires the active DVN', ok: recv.requiredDvns.length === 1 && recv.requiredDvns[0] === activeDvn, detail: recv.requiredDvns.join(', ') });
    try {
      const client = publicClient(E.chainKey);
      const evmPeerHex = await evmPeer(client, E.oft as Address, 40600);
      checks.push({ label: 'EVM TestOFT.peers(40600) == Stellar OFT', ok: evmPeerHex.toLowerCase() === S.oftHex?.toLowerCase(), detail: evmPeerHex });
      const evmEnforced = await evmEnforcedOptions(client, E.oft as Address, 40600, 1);
      checks.push({ label: 'EVM enforced options set (gas for Stellar delivery)', ok: evmEnforced !== '0x', detail: evmEnforced });
    } catch (e) {
      checks.push({ label: 'EVM side reachable', ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  } else {
    checks.push({ label: 'EVM side deployed', ok: false, detail: 'the EVM deployer needs testnet ETH; run pnpm deploy:testnet --evm' });
  }
  return checks;
}
// snippet:end loadHealth
