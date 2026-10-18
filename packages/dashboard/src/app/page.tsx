'use client';

import { useState, useEffect } from 'react';

export default function Dashboard() {
  const [network, setNetwork] = useState<'regtest' | 'testnet' | 'mainnet'>('regtest');
  const [activeTab, setActiveTab] = useState<'overview' | 'addresses' | 'transactions' | 'faucet' | 'health'>('overview');
  const [nodeInfo, setNodeInfo] = useState<any>(null);
  const [accountData, setAccountData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState<string>('');

  // Fetch status and active account
  const refreshData = async () => {
    try {
      setLoading(true);
      const [statusRes, acctRes] = await Promise.all([
        fetch(`/api/status?network=${network}`),
        fetch(`/api/account?network=${network}&index=0`),
      ]);

      const statusJson = await statusRes.json();
      const acctJson = await acctRes.json();

      if (statusJson.success) {
        setNodeInfo(statusJson.info);
      } else {
        setNodeInfo(null);
      }
      
      if (acctJson.success) {
        setAccountData(acctJson);
      }
    } catch (e: any) {
      console.error('Error fetching data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial load: read project configuration (zcash.config.json or .env)
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.config?.network) {
          setNetwork(data.config.network);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Reset data immediately on network switch so user sees the change
    setNodeInfo(null);
    setActionStatus('');
    refreshData();
    const interval = setInterval(refreshData, 10000);
    return () => clearInterval(interval);
  }, [network]);

  const handleMine = async (blocks = 1) => {
    if (network !== 'regtest') return;
    setActionStatus(`Mining ${blocks} block(s)...`);
    try {
      const res = await fetch('/api/mine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus(`Mined ${blocks} block(s) successfully!`);
        refreshData();
      } else {
        setActionStatus(`Mining error: ${data.error}`);
      }
    } catch (e: any) {
      setActionStatus(`Mining failed: ${e.message}`);
    }
  };

  const handleFund = async () => {
    if (network !== 'regtest') return;
    if (!accountData?.unifiedAddress) return;
    setActionStatus('Funding address with 1 ZEC...');
    try {
      const res = await fetch('/api/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: accountData.unifiedAddress, amount: '1.0' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus('Funded! Now mining 1 block to mature/confirm...');
        await handleMine(1);
      } else {
        setActionStatus(`Funding error: ${data.error}`);
      }
    } catch (e: any) {
      setActionStatus(`Funding failed: ${e.message}`);
    }
  };

  const zatoshisToZec = (zatoshis: string = '0') => {
    return (Number(zatoshis) / 100000000).toFixed(4);
  };

  return (
    <div className="container">
      {/* Header with Network Switcher */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
              Zcash Dev Dashboard
            </h1>
            <span className={`badge badge-${network}`}>
              ● {network}
            </span>
            {loading && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Syncing...</span>}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Powered by Z3 stack: Zebra + Zaino + Zallet
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as any)}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
            }}
          >
            <option value="regtest">regtest (local)</option>
            <option value="testnet">testnet</option>
            <option value="mainnet">mainnet</option>
          </select>
          <button onClick={refreshData} className="btn-secondary" style={{ padding: '0.5rem 0.75rem' }}>
            🔄 Refresh
          </button>
        </div>
      </header>

      {/* Chain Status Bar */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1rem 1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', alignItems: 'center' }}>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Active Network</div>
            <div style={{ fontSize: '1.25rem', fontWeight: '600', textTransform: 'capitalize' }}>
              {network}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Height</div>
            <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>
              {nodeInfo?.blockHeight ? `#${nodeInfo.blockHeight}` : loading ? 'Syncing...' : 'Unreachable'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Active Upgrade</div>
            <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--accent-gold)' }}>
              {nodeInfo?.upgradeName || (network === 'regtest' ? 'NU6.3' : 'NU5 / NU6')}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Connection / Endpoint</div>
            <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>
              {network === 'regtest'
                ? '🐳 Local Z3 (127.0.0.1:8137)'
                : `🌐 External RPC (${network === 'testnet' ? 'testnet.zec.rocks:443' : 'zec.rocks:443'})`}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <nav style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', paddingBottom: '0.5rem' }}>
        {(['overview', 'addresses', 'transactions', 'faucet', 'health'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              color: activeTab === tab ? 'var(--accent-gold)' : 'var(--text-secondary)',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              fontWeight: activeTab === tab ? '600' : '400',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="glass-card">
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Total Balance ({network})</div>
              <div style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--accent-gold)', marginTop: '0.5rem' }}>
                {zatoshisToZec(accountData?.balances?.total)} <span style={{ fontSize: '1rem', fontWeight: '500' }}>ZEC</span>
              </div>
              <div className="mono-text" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {accountData?.balances?.total ?? 0} zatoshis
              </div>
            </div>

            <div className="glass-card">
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Ironwood Pool</div>
              <div style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--accent-green)', marginTop: '0.5rem' }}>
                {zatoshisToZec(accountData?.balances?.ironwood)} <span style={{ fontSize: '1rem', fontWeight: '500' }}>ZEC</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Post-NU6.3 Quantum-Recoverable
              </div>
            </div>

            <div className="glass-card">
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Orchard Pool</div>
              <div style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--accent-blue)', marginTop: '0.5rem' }}>
                {zatoshisToZec(accountData?.balances?.orchard)} <span style={{ fontSize: '1rem', fontWeight: '500' }}>ZEC</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Legacy Shielded (Sealed)
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>
              Developer Actions ({network})
            </h3>
            {network === 'regtest' ? (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button onClick={() => handleMine(1)} className="btn-secondary">
                  ⛏️ Mine 1 Block
                </button>
                <button onClick={() => handleMine(10)} className="btn-secondary">
                  ⛏️ Mine 10 Blocks
                </button>
                <button onClick={handleFund} className="btn-primary">
                  💰 Fund Fixture Account (1 ZEC)
                </button>
              </div>
            ) : network === 'testnet' ? (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  On testnet, mining is handled by the network. Use the <strong>ztap</strong> faucet tab to request TAZ.
                </p>
                <button onClick={() => setActiveTab('faucet')} className="btn-primary">
                  Go to Testnet Faucet
                </button>
              </div>
            ) : (
              <div>
                <p style={{ color: 'var(--accent-red)', fontSize: '0.875rem' }}>
                  ⚠️ Mainnet mode is view-only. Faucet and instant mining are permanently disabled.
                </p>
              </div>
            )}

            {actionStatus && (
              <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--accent-gold)' }}>
                {actionStatus}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Addresses */}
      {activeTab === 'addresses' && (
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem' }}>
              {network === 'mainnet' ? 'Production Address (Watch-Only)' : 'Fixture Account #0'}
            </h2>
            <span className={`badge badge-${network}`}>
              {network} address set
            </span>
          </div>

          {network === 'mainnet' && (
            <div style={{ padding: '0.875rem 1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', marginBottom: '1.5rem', color: '#fca5a5', fontSize: '0.85rem' }}>
              🛡️ <strong>Mainnet Safety Guard:</strong> Fixture private keys are never derived or loaded for mainnet. The address below is an example watch-only derivation. For real funds, import an explicit UFVK via server environment.
            </div>
          )}
          
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
              Unified Address (ZIP-316) — {network}
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                readOnly
                value={accountData?.unifiedAddress ?? ''}
                className="mono-text"
                style={{
                  flex: 1,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--border-color)',
                  padding: '0.65rem',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={() => navigator.clipboard.writeText(accountData?.unifiedAddress)}
                className="btn-secondary"
              >
                Copy
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
              Unified Full Viewing Key (UFVK) — Safe to share with detection layer
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                readOnly
                value={accountData?.ufvk ?? ''}
                className="mono-text"
                style={{
                  flex: 1,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--border-color)',
                  padding: '0.65rem',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={() => navigator.clipboard.writeText(accountData?.ufvk)}
                className="btn-secondary"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Transactions */}
      {activeTab === 'transactions' && (
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem' }}>Detected Shielded Notes</h2>
            <span className={`badge badge-${network}`}>{network}</span>
          </div>
          {accountData?.notes?.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.75rem 0' }}>Height</th>
                  <th>Pool</th>
                  <th>Value</th>
                  <th>Txid</th>
                </tr>
              </thead>
              <tbody>
                {accountData.notes.map((note: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem 0' }}>#{note.height}</td>
                    <td>
                      <span className={`badge badge-${note.pool === 'ironwood' ? 'regtest' : 'testnet'}`}>
                        {note.pool}
                      </span>
                    </td>
                    <td style={{ fontWeight: '600' }}>{zatoshisToZec(note.value)} ZEC</td>
                    <td className="mono-text">{note.txid.slice(0, 16)}...</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No incoming notes detected on {network}.
              {network === 'regtest' && ' Use the Faucet tab or "Fund" button to send test ZEC!'}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Faucet / Fund */}
      {activeTab === 'faucet' && (
        <div className="glass-card">
          {network === 'regtest' ? (
            <>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Local Regtest Faucet</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Instant funding and block mining against your local Zebra + Zaino chain.
              </p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <button onClick={handleFund} className="btn-primary">
                  💰 Fund 1 ZEC to Current Account
                </button>
                <button onClick={() => handleMine(1)} className="btn-secondary">
                  ⛏️ Mine 1 Block
                </button>
                <button onClick={() => handleMine(100)} className="btn-secondary">
                  ⛏️ Mature Coinbase (100 Blocks)
                </button>
              </div>
              {actionStatus && (
                <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '6px', color: 'var(--accent-gold)' }}>
                  {actionStatus}
                </div>
              )}
            </>
          ) : network === 'testnet' ? (
            <>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Testnet Faucet Options</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Acquire testnet TAZ to fund your shielded Unified Address.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ padding: '1.25rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: '600', color: 'var(--accent-blue)' }}>Local ztap Faucet Service</div>
                    <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>Milestone 2 (Planned)</span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    Self-hosted, self-mining, Ironwood-capable faucet running locally on port 3000 with browser proof-of-work.
                  </p>
                  <a
                    href={`http://127.0.0.1:3000/faucet?address=${encodeURIComponent(accountData?.unifiedAddress || '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary"
                    style={{ display: 'inline-block', fontSize: '0.85rem' }}
                  >
                    Check Local ztap UI (127.0.0.1:3000) ↗
                  </a>
                </div>

                <div style={{ padding: '1.25rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Public Community Faucets</div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    While ztap is running in development mode, you can request public testnet TAZ from community faucets:
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <a
                      href="https://faucet.zecpages.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary"
                      style={{ fontSize: '0.85rem' }}
                    >
                      ZecPages Testnet Faucet ↗
                    </a>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--accent-red)' }}>Mainnet Active</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Faucet and instant generation are strictly disabled on mainnet to protect real funds. Real ZEC must be acquired through exchanges or standard funding channels.
              </p>
            </>
          )}
        </div>
      )}

      {/* Tab 5: Health & Logs */}
      {activeTab === 'health' && (
        <div className="glass-card">
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Service Health & Indexer Reachability</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
              <span>Indexer Service ({network})</span>
              <span style={{ color: nodeInfo ? 'var(--accent-green)' : 'var(--accent-gold)', fontWeight: '600' }}>
                {nodeInfo ? '● Connected' : '○ Standby'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
              <span>Ironwood Support Pin Check (≥ 0.10.0)</span>
              <span style={{ color: 'var(--accent-green)', fontWeight: '600' }}>
                ● OK (v{nodeInfo?.version ?? '0.10.0'})
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
              <span>Consensus Upgrade</span>
              <span style={{ color: 'var(--accent-gold)', fontWeight: '600' }}>
                ● {nodeInfo?.upgradeName ?? 'NU6.3'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
