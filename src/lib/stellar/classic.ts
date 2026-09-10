/**
 * Classic (non-Soroban) Stellar operations the playground needs: trustlines,
 * and the mock-issuer sandbox (create asset, deploy its SAC, mint by payment).
 */
import { Asset, BASE_FEE, Keypair, Operation, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { STELLAR, type StellarEnv } from '@/config/networks';
import { withRpc } from '@/lib/stellar/rpc';

async function buildClassic(env: StellarEnv, source: string, ops: ReturnType<typeof Operation.changeTrust>[]): Promise<Transaction> {
  return withRpc(env, async (server) => {
    const account = await server.getAccount(source);
    const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: STELLAR[env].passphrase });
    for (const op of ops) b.addOperation(op);
    return b.setTimeout(120).build();
  });
}

// snippet:start changeTrust
/** A G account cannot hold an issued asset until it opens a trustline. Inbound OFT deliveries to a G recipient need this first. */
export function prepareChangeTrust(env: StellarEnv, source: string, code: string, issuer: string): Promise<Transaction> {
  return buildClassic(env, source, [Operation.changeTrust({ asset: new Asset(code, issuer) })]);
}
// snippet:end changeTrust

/** Classic payment; when `source` is the issuer this IS minting. */
export function preparePayment(env: StellarEnv, source: string, destination: string, code: string, issuer: string, amount: string): Promise<Transaction> {
  return buildClassic(env, source, [Operation.payment({ destination, asset: new Asset(code, issuer), amount })]);
}

/** Deploy the SAC for a classic asset; anyone can, the id is deterministic. */
export async function prepareDeploySac(env: StellarEnv, source: string, code: string, issuer: string) {
  return withRpc(env, async (server) => {
    const account = await server.getAccount(source);
    const asset = new Asset(code, issuer);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STELLAR[env].passphrase }).addOperation(Operation.createStellarAssetContract({ asset })).setTimeout(120).build();
    const sim = await server.simulateTransaction(tx);
    const { rpc } = await import('@stellar/stellar-sdk');
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    return { tx: rpc.assembleTransaction(tx, sim).build(), contractId: asset.contractId(STELLAR[env].passphrase) };
  });
}

export function sacIdFor(env: StellarEnv, code: string, issuer: string): string {
  return new Asset(code, issuer).contractId(STELLAR[env].passphrase);
}

/** Throwaway keypair for the DIY issuer sandbox (kept only in memory). */
export const randomKeypair = () => Keypair.random();
