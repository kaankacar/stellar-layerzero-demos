/**
 * EndpointV2 helpers. The endpoint is the single entry point for sending; it
 * routes to the configured message library and holds per-OApp configuration.
 *
 *   set_config(caller, oapp, lib, params: Vec<SetConfigParam>)
 *   SetConfigParam { config: Bytes (XDR of the config struct), config_type: u32, eid: u32 }
 *   config_type 1 = executor, 2 = send ULN, 3 = receive ULN
 */
import type { StellarEnv } from '@/config/networks';
import { sc, xdr } from '@/lib/stellar/scval';
import { readContract } from '@/lib/stellar/simulate';
import { prepareInvoke, type PreparedTx } from '@/lib/stellar/tx';
import type { UlnConfig } from '@/lib/stellar/uln';

export const CONFIG_TYPE = { EXECUTOR: 1, SEND_ULN: 2, RECEIVE_ULN: 3 } as const;

export async function endpointEid(env: StellarEnv, endpoint: string): Promise<number> {
  return Number(await readContract<number>(env, endpoint, 'eid'));
}
export async function isSupportedEid(env: StellarEnv, endpoint: string, eid: number): Promise<boolean> {
  return readContract<boolean>(env, endpoint, 'is_supported_eid', [sc.u32(eid)]);
}
export async function getSendLibrary(env: StellarEnv, endpoint: string, sender: string, dstEid: number): Promise<{ lib: string; isDefault: boolean }> {
  const v = await readContract<{ lib: string; is_default: boolean }>(env, endpoint, 'get_send_library', [sc.address(sender), sc.u32(dstEid)]);
  return { lib: v.lib, isDefault: v.is_default };
}

export interface OAppUlnConfig {
  useDefaultConfirmations: boolean;
  useDefaultRequiredDvns: boolean;
  useDefaultOptionalDvns: boolean;
  ulnConfig: UlnConfig;
}

// snippet:start encodeOAppUlnConfig
/** The per-OApp ULN config, XDR-encoded as the endpoint expects inside SetConfigParam.config. */
export function oappUlnConfigScVal(c: OAppUlnConfig): xdr.ScVal {
  return sc.struct({
    uln_config: sc.struct({
      confirmations: sc.u64(c.ulnConfig.confirmations),
      optional_dvn_threshold: sc.u32(c.ulnConfig.optionalDvnThreshold),
      optional_dvns: sc.vec(c.ulnConfig.optionalDvns.map(sc.address)),
      required_dvns: sc.vec(c.ulnConfig.requiredDvns.map(sc.address)),
    }),
    use_default_confirmations: sc.bool(c.useDefaultConfirmations),
    use_default_optional_dvns: sc.bool(c.useDefaultOptionalDvns),
    use_default_required_dvns: sc.bool(c.useDefaultRequiredDvns),
  });
}
export function encodeOAppUlnConfig(c: OAppUlnConfig): Uint8Array {
  return new Uint8Array(oappUlnConfigScVal(c).toXDR());
}
export function setConfigParamScVal(p: { eid: number; configType: number; config: Uint8Array }): xdr.ScVal {
  return sc.struct({ config: sc.bytes(p.config), config_type: sc.u32(p.configType), eid: sc.u32(p.eid) });
}
// snippet:end encodeOAppUlnConfig

/** Only the OApp's delegate may call this; on our contracts the delegate is the owner/deployer. */
export function prepareSetConfig(
  env: StellarEnv,
  endpoint: string,
  caller: string,
  oapp: string,
  lib: string,
  params: { eid: number; configType: number; config: Uint8Array }[],
): Promise<PreparedTx> {
  return prepareInvoke(env, caller, endpoint, 'set_config', [sc.address(caller), sc.address(oapp), sc.address(lib), sc.vec(params.map(setConfigParamScVal))]);
}

/** A "require exactly these DVNs" override for one pathway (what testnet needs today). */
export function requiredDvnsOverride(requiredDvns: string[]): OAppUlnConfig {
  return {
    useDefaultConfirmations: true,
    useDefaultRequiredDvns: false,
    useDefaultOptionalDvns: true,
    ulnConfig: { confirmations: 0n, requiredDvns, optionalDvns: [], optionalDvnThreshold: 0 },
  };
}
