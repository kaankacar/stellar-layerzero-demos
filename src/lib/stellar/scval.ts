/**
 * Hand-built ScVal helpers. Soroban contract arguments are XDR `ScVal`s; a
 * struct is a map whose keys are symbols sorted by name, an enum variant is a
 * vec whose first item is the variant symbol. Building them by hand (instead
 * of generated bindings) keeps the "under the hood" panels honest.
 */
import { Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export const sc = {
  u32: (n: number) => xdr.ScVal.scvU32(n),
  u64: (n: bigint | number) => nativeToScVal(BigInt(n), { type: 'u64' }),
  i128: (n: bigint | number) => nativeToScVal(BigInt(n), { type: 'i128' }),
  bool: (b: boolean) => xdr.ScVal.scvBool(b),
  symbol: (s: string) => xdr.ScVal.scvSymbol(s),
  string: (s: string) => xdr.ScVal.scvString(s),
  bytes: (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b)),
  address: (a: string) => new Address(a).toScVal(),
  vec: (items: xdr.ScVal[]) => xdr.ScVal.scvVec(items),
  none: () => xdr.ScVal.scvVoid(),
  option: (v: xdr.ScVal | null | undefined) => v ?? xdr.ScVal.scvVoid(),
  /** Struct = ScMap with symbol keys in sorted order. */
  struct: (fields: Record<string, xdr.ScVal>) =>
    xdr.ScVal.scvMap(
      Object.keys(fields)
        .sort()
        .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: fields[k]! })),
    ),
  /** Unit enum variant, e.g. `Direction::Outbound`. */
  enumUnit: (variant: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]),
  /** Tuple enum variant, e.g. `OftType::MintBurn(addr)`. */
  enumTuple: (variant: string, ...values: xdr.ScVal[]) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), ...values]),
};

export { scValToNative, xdr };

export function scValToXdrBase64(v: xdr.ScVal): string {
  return v.toXDR('base64');
}

/** Normalise scValToNative output for `Option<T>`: undefined/null -> null. */
export function optional<T>(v: unknown): T | null {
  return v === undefined || v === null ? null : (v as T);
}

/** `Bytes`/`BytesN` come back as Buffers; convert to Uint8Array for the codecs. */
export function asBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  throw new Error('expected bytes');
}

/** Enum variants decode as `[variant, ...payload]`; unit variants sometimes as a bare string. */
export function enumVariant(v: unknown): { variant: string; payload: unknown[] } {
  if (typeof v === 'string') return { variant: v, payload: [] };
  if (Array.isArray(v) && typeof v[0] === 'string') return { variant: v[0], payload: v.slice(1) };
  if (v && typeof v === 'object') {
    const [k, val] = Object.entries(v as Record<string, unknown>)[0] ?? [];
    if (k) return { variant: k, payload: [val] };
  }
  throw new Error(`not an enum value: ${JSON.stringify(v)}`);
}
