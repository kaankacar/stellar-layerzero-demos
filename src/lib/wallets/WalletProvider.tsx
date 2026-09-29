/**
 * One context for the three wallet families. Each slot exposes status,
 * address, detected network, the network the current page expects, and a
 * switch action where the wallet API allows it:
 *   - EVM (MetaMask via EIP-1193): wallet_switchEthereumChain / wallet_addEthereumChain
 *   - Stellar (Wallets Kit, Freighter featured): no programmatic switch exists, so we
 *     detect the wallet's network and show how to switch inside the extension
 *   - Solana (Phantom): mainnet/devnet is chosen inside the extension as well
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createWalletClient, custom, type Address, type Hex, type WalletClient } from 'viem';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils';
import { FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { KitEventType, Networks as KitNetworks } from '@creit.tech/stellar-wallets-kit/types';
import { EVM_TESTNETS, STELLAR, type EvmTestnetKey, type StellarEnv } from '@/config/networks';
import { VIEM_CHAINS } from '@/lib/evm/chains';
import { getPhantom } from '@/lib/solana/phantom';
import { pickProvider, startProviderDiscovery, type Eip1193Provider } from '@/lib/wallets/evmProvider';

export type SlotStatus = 'disconnected' | 'connecting' | 'connected';

export interface StellarSlot {
  status: SlotStatus;
  address: string | null;
  /** Network passphrase reported by the wallet, when known. */
  networkPassphrase: string | null;
  walletId: string | null;
  error: string | null;
  expectedEnv: StellarEnv;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Signs an XDR envelope with the connected wallet; returns signed XDR. */
  signTransaction: (xdr: string) => Promise<string>;
  refreshNetwork: () => Promise<void>;
}
export interface EvmSlot {
  status: SlotStatus;
  address: Address | null;
  chainId: number | null;
  providerName: string | null;
  error: string | null;
  expectedChain: EvmTestnetKey;
  wrongNetwork: boolean;
  walletClient: WalletClient | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToExpected: () => Promise<void>;
}
export interface SolanaSlot {
  status: SlotStatus;
  address: string | null;
  installed: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}
export interface WalletContextValue {
  stellar: StellarSlot;
  evm: EvmSlot;
  solana: SolanaSlot;
  /** Pages declare what they need; the shell highlights mismatches. */
  setExpected: (expected: { stellar?: StellarEnv; evm?: EvmTestnetKey }) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const kitNetwork = (env: StellarEnv) => (env === 'mainnet' ? KitNetworks.PUBLIC : KitNetworks.TESTNET);

let kitInitialised = false;
function ensureKit(env: StellarEnv) {
  if (kitInitialised) return;
  // snippet:start walletsKitInit
  StellarWalletsKit.init({
    modules: defaultModules(),
    selectedWalletId: FREIGHTER_ID,
    network: kitNetwork(env), // the kit defaults to PUBLIC; always pass the network you mean
    theme: undefined,
  });
  // snippet:end walletsKitInit
  kitInitialised = true;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function WalletProvider({ children }: { children: ReactNode }) {
  // ---- expectations (set by pages) ----
  const [expectedStellar, setExpectedStellar] = useState<StellarEnv>('testnet');
  const [expectedEvm, setExpectedEvm] = useState<EvmTestnetKey>('arbitrum-sepolia');
  const setExpected = useCallback((e: { stellar?: StellarEnv; evm?: EvmTestnetKey }) => {
    if (e.stellar) setExpectedStellar(e.stellar);
    if (e.evm) setExpectedEvm(e.evm);
  }, []);

  // ---- Stellar ----
  const [stAddress, setStAddress] = useState<string | null>(null);
  const [stStatus, setStStatus] = useState<SlotStatus>('disconnected');
  const [stNetwork, setStNetwork] = useState<string | null>(null);
  const [stWallet, setStWallet] = useState<string | null>(null);
  const [stError, setStError] = useState<string | null>(null);

  useEffect(() => {
    ensureKit(expectedStellar);
    try {
      StellarWalletsKit.setNetwork(kitNetwork(expectedStellar));
    } catch {
      /* kit not ready */
    }
  }, [expectedStellar]);

  useEffect(() => {
    ensureKit(expectedStellar);
    const off = StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
      setStAddress(null);
      setStStatus('disconnected');
      setStNetwork(null);
    });
    const off2 = StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (ev) => {
      const id = (ev as unknown as { walletId?: string; id?: string }).walletId ?? (ev as unknown as { id?: string }).id ?? null;
      if (id) setStWallet(id);
    });
    return () => {
      off();
      off2();
    };
  }, []);

  const refreshStellarNetwork = useCallback(async () => {
    try {
      const n = await StellarWalletsKit.getNetwork();
      setStNetwork(n.networkPassphrase ?? null);
    } catch {
      setStNetwork(null);
    }
  }, []);

  const stellarConnect = useCallback(async () => {
    ensureKit(expectedStellar);
    setStStatus('connecting');
    setStError(null);
    try {
      // snippet:start walletsKitConnect
      const { address } = await StellarWalletsKit.authModal(); // wallet picker (Freighter, xBull, Albedo, ...)
      const net = await StellarWalletsKit.getNetwork().catch(() => null);
      // snippet:end walletsKitConnect
      setStAddress(address);
      setStNetwork(net?.networkPassphrase ?? null);
      setStStatus('connected');
    } catch (e) {
      setStError(errMsg(e));
      setStStatus('disconnected');
    }
  }, [expectedStellar]);

  const stellarDisconnect = useCallback(async () => {
    try {
      await StellarWalletsKit.disconnect();
    } catch {
      /* ignore */
    }
    setStAddress(null);
    setStStatus('disconnected');
    setStNetwork(null);
  }, []);

  const stellarSign = useCallback(
    async (xdr: string) => {
      if (!stAddress) throw new Error('Stellar wallet not connected');
      // snippet:start walletsKitSign
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: STELLAR[expectedStellar].passphrase,
        address: stAddress,
      });
      // snippet:end walletsKitSign
      return signedTxXdr;
    },
    [stAddress, expectedStellar],
  );

  // ---- EVM ----
  const providerRef = useRef<Eip1193Provider | null>(null);
  const [evmAddress, setEvmAddress] = useState<Address | null>(null);
  const [evmChainId, setEvmChainId] = useState<number | null>(null);
  const [evmStatus, setEvmStatus] = useState<SlotStatus>('disconnected');
  const [evmName, setEvmName] = useState<string | null>(null);
  const [evmError, setEvmError] = useState<string | null>(null);

  useEffect(() => {
    startProviderDiscovery();
  }, []);

  const attachEvmListeners = useCallback((p: Eip1193Provider) => {
    p.on?.('accountsChanged', (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      const a = accounts[0];
      setEvmAddress(a ? (a as Address) : null);
      setEvmStatus(a ? 'connected' : 'disconnected');
    });
    p.on?.('chainChanged', (...args: unknown[]) => {
      const id = args[0] as string;
      setEvmChainId(Number.parseInt(id, 16));
    });
  }, []);

  const evmConnect = useCallback(async () => {
    setEvmError(null);
    const picked = pickProvider();
    if (!picked) {
      setEvmError('No EVM wallet found. Install MetaMask.');
      return;
    }
    setEvmStatus('connecting');
    try {
      // snippet:start evmConnect
      const accounts = (await picked.provider.request({ method: 'eth_requestAccounts' })) as string[];
      const chainHex = (await picked.provider.request({ method: 'eth_chainId' })) as string;
      // snippet:end evmConnect
      providerRef.current = picked.provider;
      attachEvmListeners(picked.provider);
      setEvmName(picked.name);
      setEvmAddress((accounts[0] as Address) ?? null);
      setEvmChainId(Number.parseInt(chainHex, 16));
      setEvmStatus(accounts[0] ? 'connected' : 'disconnected');
    } catch (e) {
      setEvmError(errMsg(e));
      setEvmStatus('disconnected');
    }
  }, [attachEvmListeners]);

  const evmDisconnect = useCallback(() => {
    providerRef.current = null;
    setEvmAddress(null);
    setEvmChainId(null);
    setEvmStatus('disconnected');
  }, []);

  const evmSwitch = useCallback(async () => {
    const p = providerRef.current;
    if (!p) return;
    const target = EVM_TESTNETS[expectedEvm];
    const chain = VIEM_CHAINS[expectedEvm];
    const hexId = `0x${target.chainId.toString(16)}`;
    try {
      // snippet:start evmSwitchChain
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
      // snippet:end evmSwitchChain
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 4902) {
        await p.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexId,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [target.rpcUrl],
              blockExplorerUrls: [target.explorer],
            },
          ],
        });
      } else {
        setEvmError(errMsg(e));
      }
    }
  }, [expectedEvm]);

  const walletClient = useMemo(() => {
    const p = providerRef.current;
    if (!p || !evmAddress) return null;
    const chain = Object.values(VIEM_CHAINS).find((c) => c.id === evmChainId);
    return createWalletClient({ account: evmAddress, chain, transport: custom(p) });
  }, [evmAddress, evmChainId]);

  // ---- Solana ----
  const [solAddress, setSolAddress] = useState<string | null>(null);
  const [solStatus, setSolStatus] = useState<SlotStatus>('disconnected');
  const [solError, setSolError] = useState<string | null>(null);
  const [solInstalled, setSolInstalled] = useState(false);
  useEffect(() => {
    const p = getPhantom();
    setSolInstalled(!!p);
    if (!p) return;
    const onDisconnect = () => {
      setSolAddress(null);
      setSolStatus('disconnected');
    };
    p.on('disconnect', onDisconnect);
    return () => p.off?.('disconnect', onDisconnect);
  }, []);
  const solConnect = useCallback(async () => {
    const p = getPhantom();
    if (!p) {
      setSolError('Phantom not detected.');
      return;
    }
    setSolStatus('connecting');
    setSolError(null);
    try {
      const { publicKey } = await p.connect();
      setSolAddress(publicKey.toString());
      setSolStatus('connected');
    } catch (e) {
      setSolError(errMsg(e));
      setSolStatus('disconnected');
    }
  }, []);
  const solDisconnect = useCallback(async () => {
    await getPhantom()?.disconnect().catch(() => undefined);
    setSolAddress(null);
    setSolStatus('disconnected');
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      stellar: {
        status: stStatus,
        address: stAddress,
        networkPassphrase: stNetwork,
        walletId: stWallet,
        error: stError,
        expectedEnv: expectedStellar,
        wrongNetwork: stStatus === 'connected' && stNetwork !== null && stNetwork !== STELLAR[expectedStellar].passphrase,
        connect: stellarConnect,
        disconnect: stellarDisconnect,
        signTransaction: stellarSign,
        refreshNetwork: refreshStellarNetwork,
      },
      evm: {
        status: evmStatus,
        address: evmAddress,
        chainId: evmChainId,
        providerName: evmName,
        error: evmError,
        expectedChain: expectedEvm,
        wrongNetwork: evmStatus === 'connected' && evmChainId !== null && evmChainId !== EVM_TESTNETS[expectedEvm].chainId,
        walletClient,
        connect: evmConnect,
        disconnect: evmDisconnect,
        switchToExpected: evmSwitch,
      },
      solana: { status: solStatus, address: solAddress, installed: solInstalled, error: solError, connect: solConnect, disconnect: solDisconnect },
      setExpected,
    }),
    [
      stStatus, stAddress, stNetwork, stWallet, stError, expectedStellar, stellarConnect, stellarDisconnect, stellarSign, refreshStellarNetwork,
      evmStatus, evmAddress, evmChainId, evmName, evmError, expectedEvm, walletClient, evmConnect, evmDisconnect, evmSwitch,
      solStatus, solAddress, solInstalled, solError, solConnect, solDisconnect, setExpected,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallets(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallets must be used inside <WalletProvider>');
  return ctx;
}

/** Declare the networks a page needs; the shell shows wrong-network warnings accordingly. */
export function usePageNetworks(expected: { stellar?: StellarEnv; evm?: EvmTestnetKey }) {
  const { setExpected } = useWallets();
  const { stellar, evm } = expected;
  useEffect(() => {
    setExpected({ stellar, evm });
  }, [setExpected, stellar, evm]);
}

export type { Hex as EvmHex };
