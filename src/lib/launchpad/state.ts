/**
 * Launchpad progress, persisted in localStorage so a refresh does not lose a
 * half-launched token. The throwaway issuer secret lives here too: it is a
 * TESTNET key generated in the browser for this demo, never a user's wallet key.
 */
import type { Address, Hex } from 'viem';

export type OftMode = 'MintBurn' | 'LockUnlock';

export interface LaunchState {
  version: 1;
  createdAt: string;
  name: string;
  code: string;
  mode: OftMode;
  initialSupply: string;
  issuerSecret?: string;
  issuer?: string;
  issuerFunded?: boolean;
  sac?: string;
  sacManager?: string;
  oft?: string;
  oftHex?: Hex;
  trustline?: boolean;
  minted?: boolean;
  adminHandedOff?: boolean;
  roleGranted?: boolean;
  issuerLocked?: boolean;
  evmOft?: Address;
  evmPeerSet?: boolean;
  evmEnforcedSet?: boolean;
  stellarPeerSet?: boolean;
  stellarEnforcedSet?: boolean;
  stellarConfigSet?: boolean;
  owner?: string; // Stellar wallet that owns the contracts
  evmOwner?: Address;
}

const KEY = 'launchpad:v1';

export function loadLaunch(): LaunchState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LaunchState) : null;
  } catch {
    return null;
  }
}
export function saveLaunch(s: LaunchState | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function newLaunch(input: { name: string; code: string; mode: OftMode; initialSupply: string }): LaunchState {
  return { version: 1, createdAt: new Date().toISOString(), ...input };
}

export const CODE_RE = /^[A-Za-z0-9]{1,12}$/;
