/**
 * Read-only contract calls via `simulateTransaction`.
 *
 * Soroban has no separate "view call" RPC: you build a transaction that
 * invokes the function, ask the RPC to simulate it, and read the return value
 * from the simulation. Nothing is signed, nothing is submitted, and the
 * source account only needs to exist so the envelope is well-formed.
 */
import { Account, BASE_FEE, Contract, TransactionBuilder, rpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { STELLAR, type StellarEnv } from '@/config/networks';
import { USDT0 } from '@/config/usdt0';
import { withRpc } from '@/lib/stellar/rpc';

export class SimulationError extends Error {
  readonly code: number | null;
  readonly known: string | null;
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = 'SimulationError';
    const m = raw.match(/Error\((Contract|WasmVm|Auth|Storage|Budget|Value|Context|Object|Crypto|Events|Budget), #?(\d+)\)/);
    this.code = m ? Number(m[2]) : null;
    this.known = this.code !== null ? (KNOWN_CONTRACT_ERRORS[this.code] ?? null) : null;
  }
}

/** Error codes from the LayerZero Stellar contracts we interact with. */
export const KNOWN_CONTRACT_ERRORS: Record<number, string> = {
  1213: 'Endpoint: UnsupportedMessageLib (the send library / DVN pair is not supported: set a per-OApp ULN config)',
  2000: 'OApp: InvalidOptions',
  2001: 'OApp: NoPeer (set_peer has not been called for this eid)',
  2002: 'OApp: OnlyPeer',
  2003: 'OApp: ZroTokenUnavailable',
  3000: 'OFT: InvalidAddress',
  3001: 'OFT: InvalidAmount',
  3002: 'OFT: InvalidLocalDecimals',
  3003: 'OFT: NotInitialized',
  3004: 'OFT: Overflow',
  3005: 'OFT: SlippageExceeded (amount_received_ld < min_amount_ld)',
  3110: 'OFT: Paused',
};

export interface SimResult<T> {
  value: T;
  /** Unsigned transaction envelope that was simulated (base64 XDR). */
  txXdr: string;
  latestLedger: number;
  minResourceFee: string;
  /** Reserved: CPU metering is not exposed by the SDK's simulation type in v17. */
  cpuInstructions: string | undefined;
  rpcUrl: string;
}

export const simulationSource = (env: StellarEnv, override?: string) =>
  override ?? (env === 'mainnet' ? USDT0.simulationSource : 'GBFHBCKL7NT2QRMX26DSF4TST5O55ONI6DHNC3L6YPLF3UIYP5ZDPEKS');

// snippet:start simulateRead
export async function simulateRead<T = unknown>(
  env: StellarEnv,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
  source?: string,
): Promise<SimResult<T>> {
  return withRpc(env, async (server, rpcUrl) => {
    // Any existing account works as the envelope source; sequence is irrelevant for simulation.
    const account = new Account(simulationSource(env, source), '0');
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STELLAR[env].passphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      const se = new SimulationError(`${method} failed: ${sim.error}`, sim.error);
      throw se;
    }
    const retval = sim.result?.retval;
    return {
      value: (retval ? scValToNative(retval) : undefined) as T,
      txXdr: tx.toXDR(),
      latestLedger: sim.latestLedger,
      minResourceFee: sim.minResourceFee,
      cpuInstructions: undefined,
      rpcUrl,
    };
  });
}
// snippet:end simulateRead

/** Convenience: value only. */
export async function readContract<T = unknown>(env: StellarEnv, contractId: string, method: string, args: xdr.ScVal[] = [], source?: string): Promise<T> {
  return (await simulateRead<T>(env, contractId, method, args, source)).value;
}

/** Does a contract instance exist on the ledger? (How the OFT disambiguates C vs G recipients.) */
export async function contractExists(env: StellarEnv, contractId: string): Promise<boolean> {
  return withRpc(env, async (server) => {
    const key = new Contract(contractId).getFootprint();
    const res = await server.getLedgerEntries(key);
    return res.entries.length > 0;
  });
}
