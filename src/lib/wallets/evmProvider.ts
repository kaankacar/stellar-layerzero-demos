/**
 * EIP-1193 provider discovery via EIP-6963 (multi-wallet announce) with a
 * `window.ethereum` fallback. MetaMask is preferred when several are present.
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}
export interface DiscoveredProvider {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

const discovered = new Map<string, DiscoveredProvider>();
let listening = false;

export function startProviderDiscovery(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('eip6963:announceProvider', (ev: Event) => {
    const detail = (ev as CustomEvent<DiscoveredProvider>).detail;
    if (detail?.info?.uuid) discovered.set(detail.info.uuid, detail);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function listProviders(): DiscoveredProvider[] {
  return [...discovered.values()];
}

/** Pick MetaMask if announced, else the first announced wallet, else the legacy injected provider. */
export function pickProvider(): { provider: Eip1193Provider; name: string } | null {
  const list = listProviders();
  const mm = list.find((p) => p.info.rdns === 'io.metamask' || /metamask/i.test(p.info.name));
  const chosen = mm ?? list[0];
  if (chosen) return { provider: chosen.provider, name: chosen.info.name };
  const eth = (window as unknown as { ethereum?: Eip1193Provider & { isMetaMask?: boolean } }).ethereum;
  if (eth) return { provider: eth, name: eth.isMetaMask ? 'MetaMask' : 'Injected wallet' };
  return null;
}
