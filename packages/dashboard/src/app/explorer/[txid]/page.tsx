'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function ExplorerTxPage() {
  const params = useParams();
  const txid = typeof params?.txid === 'string' ? params.txid : Array.isArray(params?.txid) ? params.txid[0] : '';

  return (
    <div className="container" style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <Link href="/" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', textDecoration: 'none', fontSize: '0.85rem' }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <span style={{ color: 'var(--accent-gold)' }}>🔍</span> Transaction Explorer
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Phase 3 Explorer route (Placeholder)
        </p>
      </header>

      <div className="glass-card" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <span className="badge badge-regtest" style={{ fontSize: '0.8rem', padding: '0.25rem 0.65rem' }}>
            TX INSPECTION
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Deep on-chain parsing scheduled for Phase 3
          </span>
        </div>

        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Transaction Identifier</h2>
        <div
          id="explorer-txid"
          className="mono-text"
          style={{
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '0.85rem',
            wordBreak: 'break-all',
            color: 'var(--accent-gold)',
            marginBottom: '1.5rem',
          }}
        >
          {txid || 'No transaction ID specified'}
        </div>

        <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          <p>
            ℹ️ <strong>Explorer Phase 3 Notice:</strong> Full decoded raw transaction structures, Orchard/Ironwood action commitments, nullifier graph tracing, and transparent input scripts will be integrated during Phase 3.
          </p>
        </div>
      </div>
    </div>
  );
}
