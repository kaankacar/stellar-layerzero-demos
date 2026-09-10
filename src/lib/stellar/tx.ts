/**
 * The write path: build -> simulate -> assemble -> sign (wallet) -> submit -> poll.
 *
 * `from` is the transaction source, so every `require_auth()` on that address
 * inside the contract call is satisfied by the envelope signature; no separate
 * authorization entries are needed for the user.
 */
import { BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative, xdr, type Transaction } from '@stellar/stellar-sdk';
import { STELLAR, type StellarEnv } from '@/config/networks';
import { withRpc } from '@/lib/stellar/rpc';
import { SimulationError } from '@/lib/stellar/simulate';

export interface PreparedTx {
  /** Assembled (simulated, footprint + resource fee applied) but unsigned transaction. */
  tx: Transaction;
  unsignedXdr: string;
  minResourceFee: string;
  simulation: rpc.Api.SimulateTransactionSuccessResponse;
}

// snippet:start prepareInvoke
export async function prepareInvoke(
  env: StellarEnv,
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  opts: { timeoutSeconds?: number; feeStroops?: string; memo?: undefined } = {},
): Promise<PreparedTx> {
  return withRpc(env, async (server) => {
    const account = await server.getAccount(source); // real sequence number: this one will be signed
    const tx = new TransactionBuilder(account, { fee: opts.feeStroops ?? BASE_FEE, networkPassphrase: STELLAR[env].passphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(opts.timeoutSeconds ?? 120)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new SimulationError(`${method} failed: ${sim.error}`, sim.error);
    if (rpc.Api.isSimulationRestore(sim)) throw new Error('Contract state is archived and needs restoring before this call.');
    const assembled = rpc.assembleTransaction(tx, sim).build();
    return { tx: assembled, unsignedXdr: assembled.toXDR(), minResourceFee: sim.minResourceFee, simulation: sim };
  });
}
// snippet:end prepareInvoke

export interface SubmitResult {
  hash: string;
  status: rpc.Api.GetTransactionStatus;
  response: rpc.Api.GetTransactionResponse;
  returnValue: unknown;
}

// snippet:start submitAndPoll
export async function submitAndPoll(env: StellarEnv, signedXdr: string, timeoutMs = 90_000): Promise<SubmitResult> {
  return withRpc(env, async (server) => {
    const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR[env].passphrase);
    const sent = await server.sendTransaction(tx);
    if (sent.status === 'ERROR' || sent.status === 'DUPLICATE' || sent.status === 'TRY_AGAIN_LATER') {
      const detail = sent.errorResult ? sent.errorResult.toXDR('base64') : '';
      throw new Error(`sendTransaction ${sent.status}${detail ? ` (${detail})` : ''}`);
    }
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await server.getTransaction(sent.hash);
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { hash: sent.hash, status: res.status, response: res, returnValue: res.returnValue ? decodeReturn(res.returnValue) : undefined };
      }
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`transaction failed: ${res.resultXdr?.toXDR('base64') ?? sent.hash}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`timed out waiting for ${sent.hash}`);
  });
}
// snippet:end submitAndPoll

function decodeReturn(v: xdr.ScVal): unknown {
  try {
    return scValToNative(v);
  } catch {
    return v.toXDR('base64');
  }
}
