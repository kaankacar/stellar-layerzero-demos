/**
 * ULN302 (the message library) holds the security configuration: which DVNs
 * must verify a pathway, how many source confirmations, and which executor.
 * `effective_*` returns the OApp's own config merged over the library defaults,
 * i.e. exactly what applies to a message right now.
 */
import type { StellarEnv } from '@/config/networks';
import { sc, optional } from '@/lib/stellar/scval';
import { readContract } from '@/lib/stellar/simulate';

export interface UlnConfig {
  confirmations: bigint;
  requiredDvns: string[];
  optionalDvns: string[];
  optionalDvnThreshold: number;
}
export interface ExecutorConfig {
  executor: string;
  maxMessageSize: number;
}
type RawUln = { confirmations: bigint; required_dvns: string[]; optional_dvns: string[]; optional_dvn_threshold: number };
const fromRaw = (r: RawUln): UlnConfig => ({
  confirmations: BigInt(r.confirmations),
  requiredDvns: r.required_dvns,
  optionalDvns: r.optional_dvns,
  optionalDvnThreshold: Number(r.optional_dvn_threshold),
});

// snippet:start effectiveSendUlnConfig
/** The DVN set + confirmations that protect messages this OApp sends to `dstEid`. */
export async function effectiveSendUlnConfig(env: StellarEnv, uln: string, sender: string, dstEid: number): Promise<UlnConfig> {
  return fromRaw(await readContract<RawUln>(env, uln, 'effective_send_uln_config', [sc.address(sender), sc.u32(dstEid)]));
}
// snippet:end effectiveSendUlnConfig

export async function effectiveReceiveUlnConfig(env: StellarEnv, uln: string, receiver: string, srcEid: number): Promise<UlnConfig> {
  return fromRaw(await readContract<RawUln>(env, uln, 'effective_receive_uln_config', [sc.address(receiver), sc.u32(srcEid)]));
}

export async function defaultSendUlnConfig(env: StellarEnv, uln: string, dstEid: number): Promise<UlnConfig | null> {
  const v = optional<RawUln>(await readContract(env, uln, 'default_send_uln_config', [sc.u32(dstEid)]));
  return v ? fromRaw(v) : null;
}

export async function defaultReceiveUlnConfig(env: StellarEnv, uln: string, srcEid: number): Promise<UlnConfig | null> {
  const v = optional<RawUln>(await readContract(env, uln, 'default_receive_uln_config', [sc.u32(srcEid)]));
  return v ? fromRaw(v) : null;
}

export async function effectiveExecutorConfig(env: StellarEnv, uln: string, sender: string, dstEid: number): Promise<ExecutorConfig> {
  const v = await readContract<{ executor: string; max_message_size: number }>(env, uln, 'effective_executor_config', [sc.address(sender), sc.u32(dstEid)]);
  return { executor: v.executor, maxMessageSize: Number(v.max_message_size) };
}
