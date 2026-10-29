'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ExplorerTab } from '../../components/ExplorerTab';
import { NETWORK_PRESETS, PresetId } from '../../endpoints';

export default function ExplorerTxPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const txid = typeof params?.txid === 'string' ? params.txid : Array.isArray(params?.txid) ? params.txid[0] : '';

  const [activePreset, setActivePreset] = useState<PresetId>('testnet');

  useEffect(() => {
    const qPreset = searchParams.get('preset') as PresetId | null;
    if (qPreset && NETWORK_PRESETS[qPreset]) {
      setActivePreset(qPreset);
      return;
    }
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.config?.preset && NETWORK_PRESETS[data.config.preset as PresetId]) {
          setActivePreset(data.config.preset as PresetId);
        }
      })
      .catch(() => {});
  }, [searchParams]);

  const presetObj = NETWORK_PRESETS[activePreset] || NETWORK_PRESETS['testnet'];
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
