/**
 * Minimal Phantom integration (no wallet-adapter dependency). Solana appears
 * on this site only where it genuinely fits: the wallet bar and the message
 * tracker (look up messages a Solana wallet originated).
 */
export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  on(event: 'connect' | 'disconnect' | 'accountChanged', handler: (arg: unknown) => void): void;
  off?(event: 'connect' | 'disconnect' | 'accountChanged', handler: (arg: unknown) => void): void;
}

export function getPhantom(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const p = w.phantom?.solana ?? w.solana;
  return p?.isPhantom ? p : null;
}

export const isSolanaAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
