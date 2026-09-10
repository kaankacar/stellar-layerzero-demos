/**
 * Stellar addresses are StrKeys: 1 version byte + 32-byte payload + 2-byte CRC.
 * LayerZero carries only the 32-byte payload (as `bytes32`), never the strkey
 * string. Getting this wrong sends funds to an address nobody controls.
 *
 *   G… account  -> the Ed25519 public key
 *   C… contract -> the contract id hash
 *
 * On the destination the OFT resolves a bytes32 contract-first: if a contract
 * with that id exists it credits the contract, otherwise the G account.
 */
import { StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { bytesToHex, hexToBytes, type Hex } from '@/lib/hex';

// snippet:start stellarToBytes32
export function stellarAddressToBytes32(address: string): Uint8Array {
  if (StrKey.isValidContract(address)) return new Uint8Array(StrKey.decodeContract(address));
  if (StrKey.isValidEd25519PublicKey(address)) return new Uint8Array(StrKey.decodeEd25519PublicKey(address));
  throw new Error(`Not a G… or C… address: ${address}`);
}

export function stellarAddressToHex(address: string): Hex {
  return bytesToHex(stellarAddressToBytes32(address)) as Hex;
}

/** Both possible readings of a 32-byte payload; the ledger decides which one is real. */
export function bytes32ToStellarCandidates(bytes32: Uint8Array | string): { contract: string; account: string } {
  const b = typeof bytes32 === 'string' ? hexToBytes(bytes32) : bytes32;
  if (b.length !== 32) throw new Error('expected 32 bytes');
  const buf = Buffer.from(b);
  return { contract: StrKey.encodeContract(buf), account: StrKey.encodeEd25519PublicKey(buf) };
}
// snippet:end stellarToBytes32

export const isStellarAccount = (s: string) => StrKey.isValidEd25519PublicKey(s);
export const isStellarContract = (s: string) => StrKey.isValidContract(s);
export const isStellarAddress = (s: string) => isStellarAccount(s) || isStellarContract(s);
