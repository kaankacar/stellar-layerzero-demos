/** Byte/hex helpers shared by the LayerZero codecs. All inputs tolerate a 0x prefix. */
export type Hex = `0x${string}`;

export function strip0x(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
  if (clean.length % 2 !== 0) throw new Error(`Odd-length hex: ${hex}`);
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`Not hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array, prefix = true): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return prefix ? `0x${s}` : s;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function bigintToBytesBE(value: bigint, byteLength: number): Uint8Array {
  if (value < 0n) throw new Error('negative value');
  const out = new Uint8Array(byteLength);
  let v = value;
  for (let i = byteLength - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`value does not fit in ${byteLength} bytes`);
  return out;
}

export function bytesToBigintBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export function u16be(n: number): Uint8Array {
  return bigintToBytesBE(BigInt(n), 2);
}
export function u32be(n: number): Uint8Array {
  return bigintToBytesBE(BigInt(n), 4);
}

/** Left-pad a 20-byte EVM address to the 32-byte form LayerZero uses everywhere. */
export function evmAddressToBytes32(address: string): Uint8Array {
  const b = hexToBytes(address);
  if (b.length !== 20) throw new Error(`EVM address must be 20 bytes, got ${b.length}`);
  return concatBytes(new Uint8Array(12), b);
}

export function bytes32ToEvmAddress(bytes32: Uint8Array | string): Hex {
  const b = typeof bytes32 === 'string' ? hexToBytes(bytes32) : bytes32;
  if (b.length !== 32) throw new Error('expected 32 bytes');
  if (b.slice(0, 12).some((x) => x !== 0)) throw new Error('not a left-padded EVM address');
  return bytesToHex(b.slice(12)) as Hex;
}

export function isHex32(s: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(s);
}
export function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}
export function isEvmTxHash(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}
export function isStellarTxHash(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}
