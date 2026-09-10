import { useState } from 'react';
import { EVM_TESTNETS, STELLAR } from '@/config/networks';
import { useWallets } from '@/lib/wallets/WalletProvider';
import { truncate } from '@/lib/format';

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="text-muted hover:text-text"
      title="Copy address"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? '✓' : '⧉'}
    </button>
  );
}

export function WalletBar() {
  const { stellar, evm, solana } = useWallets();
  const stNet = stellar.networkPassphrase === STELLAR.mainnet.passphrase ? 'Mainnet' : stellar.networkPassphrase === STELLAR.testnet.passphrase ? 'Testnet' : stellar.networkPassphrase ? 'Other network' : null;
  const evmNet = Object.values(EVM_TESTNETS).find((c) => c.chainId === evm.chainId)?.label ?? (evm.chainId === 1 ? 'Ethereum' : evm.chainId ? `chain ${evm.chainId}` : null);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="mr-1 text-muted">Wallets</span>

      {/* Stellar */}
      <div className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${stellar.wrongNetwork ? 'border-warn/60 bg-warn/10' : 'border-border bg-surface'}`}>
        <span className="font-semibold">Stellar</span>
        {stellar.status === 'connected' && stellar.address ? (
          <>
            <span className="mono">{truncate(stellar.address, 5, 4)}</span>
            <Copy text={stellar.address} />
            <span className="text-muted">{stNet ?? 'network unknown'}</span>
            {stellar.wrongNetwork ? (
              <span className="text-warn" title="Open Freighter, click the network name at the top and pick the expected network. Freighter has no API for sites to switch it.">
                ⚠ switch to {stellar.expectedEnv === 'mainnet' ? 'Mainnet' : 'Testnet'} in your wallet
              </span>
            ) : null}
            <button className="text-muted hover:text-text" onClick={() => void stellar.disconnect()}>disconnect</button>
          </>
        ) : (
          <button className="text-accent hover:underline" onClick={() => void stellar.connect()} disabled={stellar.status === 'connecting'}>
            {stellar.status === 'connecting' ? 'connecting…' : 'connect Freighter / others'}
          </button>
        )}
      </div>

      {/* EVM */}
      <div className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${evm.wrongNetwork ? 'border-warn/60 bg-warn/10' : 'border-border bg-surface'}`}>
        <span className="font-semibold">EVM</span>
        {evm.status === 'connected' && evm.address ? (
          <>
            <span className="mono">{truncate(evm.address, 6, 4)}</span>
            <Copy text={evm.address} />
            <span className="text-muted">{evmNet ?? 'unknown chain'}</span>
            {evm.wrongNetwork ? (
              <button className="text-warn hover:underline" onClick={() => void evm.switchToExpected()}>
                ⚠ switch to {EVM_TESTNETS[evm.expectedChain].label}
              </button>
            ) : null}
            <button className="text-muted hover:text-text" onClick={evm.disconnect}>disconnect</button>
          </>
        ) : (
          <button className="text-accent hover:underline" onClick={() => void evm.connect()} disabled={evm.status === 'connecting'}>
            {evm.status === 'connecting' ? 'connecting…' : 'connect MetaMask'}
          </button>
        )}
      </div>

      {/* Solana */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1">
        <span className="font-semibold">Solana</span>
        {solana.status === 'connected' && solana.address ? (
          <>
            <span className="mono">{truncate(solana.address, 4, 4)}</span>
            <Copy text={solana.address} />
            <button className="text-muted hover:text-text" onClick={() => void solana.disconnect()}>disconnect</button>
          </>
        ) : (
          <button className="text-accent hover:underline disabled:text-muted" onClick={() => void solana.connect()} disabled={!solana.installed} title={solana.installed ? '' : 'Phantom not detected'}>
            {solana.installed ? 'connect Phantom' : 'Phantom not detected'}
          </button>
        )}
      </div>

      {(stellar.error || evm.error || solana.error) && <span className="text-danger">{stellar.error ?? evm.error ?? solana.error}</span>}
    </div>
  );
}
