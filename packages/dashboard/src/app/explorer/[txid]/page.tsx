'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ExplorerTab } from '../../components/ExplorerTab';
import { NetworkSelector } from '../../components/NetworkSelector';
import { NETWORK_PRESETS, PresetId } from '../../endpoints';

export default function ExplorerTxPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const txid = typeof params?.txid === 'string' ? params.txid : Array.isArray(params?.txid) ? params.txid[0] : '';

  const qPreset = searchParams.get('preset') as PresetId | null;
  const qNetwork = searchParams.get('network');

  // Synchronously initialize preset if available in query params, or default to regtest-nu7
  const [activePreset, setActivePreset] = useState<PresetId>(() => {
    if (qPreset && NETWORK_PRESETS[qPreset]) return qPreset;
    if (qNetwork === 'regtest') return 'regtest-nu7';
    if (qNetwork === 'testnet') return 'testnet';
    if (qNetwork === 'mainnet') return 'mainnet';
    return 'regtest-nu7';
  });

  useEffect(() => {
    const p = searchParams.get('preset') as PresetId | null;
    if (p && NETWORK_PRESETS[p]) {
      setActivePreset(p);
      return;
    }
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.config) {
          const cfgPreset = data.config.preset as PresetId | undefined;
          if (cfgPreset && NETWORK_PRESETS[cfgPreset]) {
            setActivePreset(cfgPreset);
            return;
          }
          if (data.config.network === 'testnet') {
            setActivePreset('testnet');
            return;
          }
          if (data.config.network === 'mainnet') {
            setActivePreset('mainnet');
            return;
          }
          if (data.config.network === 'regtest') {
            setActivePreset(data.config.endpoint?.includes('28137') ? 'regtest-z3' : 'regtest-nu7');
            return;
          }
        }
      })
      .catch(() => {});
  }, [searchParams]);

  const presetObj = NETWORK_PRESETS[activePreset] || NETWORK_PRESETS['regtest-nu7'];
  const network = presetObj.network;

  return (
    <div className="container" style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <Link
            href="/"
            className="btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.75rem',
              textDecoration: 'none',
              fontSize: '0.85rem',
            }}
          >
            ← Back to Dashboard
          </Link>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ color: 'var(--accent-gold)' }}>🔍</span> Transaction & Block Explorer
          </h1>
        </div>

        <NetworkSelector
          activePreset={activePreset}
          onSelectPreset={(p) => setActivePreset(p)}
          isConnected={true}
          endpoint={presetObj.endpoint}
        />

        {/* Backward compatibility anchor */}
        <span id="explorer-txid" style={{ display: 'none' }}>
          {txid}
        </span>
      </header>

      <main>
        <ExplorerTab
          preset={activePreset}
          network={network}
          initialQuery={txid}
        />
      </main>
    </div>
  );
}
