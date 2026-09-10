/**
 * LayerZero "Options Type 3" codec.
 *
 * Every OApp send carries an options blob telling workers what to do on the
 * destination. The layout is chain-agnostic and is what the executor reads:
 *
 *   0x0003                 options type (u16)          "type 3"
 *   0x01                   worker id (u8)              1 = executor
 *   0x0011 / 0x0021        option size (u16)           17 = type + gas, 33 = type + gas + value
 *   0x01                   option type (u8)            1 = lzReceive, 2 = nativeDrop, 3 = lzCompose
 *   <gas u128 BE>[<value u128 BE>]
 *
 * The bytes below decode the real enforced options read from the USDT0 OFT on
 * Stellar (80,000 gas towards Ethereum) and from the Ethereum adapter
 * (500,000 "gas" towards Stellar). Options are concatenated: the OApp's
 * enforced options come first, then whatever the caller adds.
 */
import { bigintToBytesBE, bytesToBigintBE, bytesToHex, concatBytes, hexToBytes, u16be, type Hex } from '@/lib/hex';

export const OPTIONS_TYPE_3 = 3;
export const WORKER_EXECUTOR = 1;
export const WORKER_DVN = 2;
export const EXECUTOR_OPTION_LZRECEIVE = 1;
export const EXECUTOR_OPTION_NATIVE_DROP = 2;
export const EXECUTOR_OPTION_LZCOMPOSE = 3;
export const EXECUTOR_OPTION_ORDERED = 4;

export interface ExecutorOption {
  worker: number;
  optionType: number;
  gas?: bigint;
  value?: bigint;
  /** nativeDrop receiver / lzCompose index, when applicable. */
  receiver?: string;
  index?: number;
  raw: Hex;
}

export interface DecodedOptions {
  type: number;
  options: ExecutorOption[];
}

// snippet:start encodeLzReceiveOption
/** Build a type-3 options blob with a single executor lzReceive option. */
export function encodeLzReceiveOption(gas: bigint, value = 0n): Hex {
  const gasBytes = bigintToBytesBE(gas, 16);
  const body = value === 0n ? gasBytes : concatBytes(gasBytes, bigintToBytesBE(value, 16));
  const option = concatBytes(
    new Uint8Array([WORKER_EXECUTOR]),
    u16be(1 + body.length), // option type byte + payload
    new Uint8Array([EXECUTOR_OPTION_LZRECEIVE]),
    body,
  );
  return bytesToHex(concatBytes(u16be(OPTIONS_TYPE_3), option)) as Hex;
}
// snippet:end encodeLzReceiveOption

/** Append extra options to an existing type-3 blob (what the OApp does with enforced + caller options). */
export function combineOptions(enforced: Hex, extra: Hex): Hex {
  const e = hexToBytes(enforced);
  const x = hexToBytes(extra);
  if (x.length === 0) return enforced;
  if (e.length === 0) return extra;
  return bytesToHex(concatBytes(e, x.slice(2))) as Hex;
}

// snippet:start decodeOptions
export function decodeOptions(hex: string): DecodedOptions {
  const b = hexToBytes(hex);
  if (b.length < 2) throw new Error('options too short');
  const type = (b[0]! << 8) | b[1]!;
  const options: ExecutorOption[] = [];
  if (type !== OPTIONS_TYPE_3) return { type, options };
  let off = 2;
  while (off < b.length) {
    const worker = b[off]!;
    const size = (b[off + 1]! << 8) | b[off + 2]!;
    const optionType = b[off + 3]!;
    const payload = b.slice(off + 4, off + 3 + size);
    const raw = bytesToHex(b.slice(off, off + 3 + size)) as Hex;
    const opt: ExecutorOption = { worker, optionType, raw };
    if (worker === WORKER_EXECUTOR) {
      if (optionType === EXECUTOR_OPTION_LZRECEIVE) {
        opt.gas = bytesToBigintBE(payload.slice(0, 16));
        if (payload.length >= 32) opt.value = bytesToBigintBE(payload.slice(16, 32));
      } else if (optionType === EXECUTOR_OPTION_NATIVE_DROP) {
        opt.value = bytesToBigintBE(payload.slice(0, 16));
        opt.receiver = bytesToHex(payload.slice(16, 48));
      } else if (optionType === EXECUTOR_OPTION_LZCOMPOSE) {
        opt.index = (payload[0]! << 8) | payload[1]!;
        opt.gas = bytesToBigintBE(payload.slice(2, 18));
        if (payload.length >= 34) opt.value = bytesToBigintBE(payload.slice(18, 34));
      }
    }
    options.push(opt);
    off += 3 + size;
  }
  return { type, options };
}
// snippet:end decodeOptions

export function describeOption(o: ExecutorOption): string {
  if (o.worker !== WORKER_EXECUTOR) return `worker ${o.worker} option ${o.optionType}`;
  switch (o.optionType) {
    case EXECUTOR_OPTION_LZRECEIVE:
      return `lzReceive gas ${o.gas?.toString() ?? '?'}${o.value ? `, value ${o.value}` : ''}`;
    case EXECUTOR_OPTION_NATIVE_DROP:
      return `nativeDrop ${o.value?.toString() ?? '?'} to ${o.receiver ?? '?'}`;
    case EXECUTOR_OPTION_LZCOMPOSE:
      return `lzCompose #${o.index ?? '?'} gas ${o.gas?.toString() ?? '?'}`;
    case EXECUTOR_OPTION_ORDERED:
      return 'ordered execution';
    default:
      return `executor option ${o.optionType}`;
  }
}
