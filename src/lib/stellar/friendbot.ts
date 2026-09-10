import { STELLAR } from '@/config/networks';

// snippet:start friendbot
/** Testnet only: ask Friendbot to create and fund an account with 10,000 XLM. */
export async function fundWithFriendbot(address: string): Promise<{ hash: string }> {
  const base = STELLAR.testnet.friendbot;
  if (!base) throw new Error('no friendbot for this network');
  const res = await fetch(`${base}/?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 400 && text.includes('createAccountAlreadyExist')) return { hash: 'already-funded' };
    throw new Error(`Friendbot ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { hash?: string };
  return { hash: json.hash ?? '' };
}
// snippet:end friendbot
