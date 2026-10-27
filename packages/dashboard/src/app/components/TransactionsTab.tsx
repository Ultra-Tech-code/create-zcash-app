'use client';

import React from 'react';

interface TransactionsTabProps {
  notes: any[];
}

export const TransactionsTab: React.FC<TransactionsTabProps> = ({ notes }) => {
  const zatoshisToZec = (zatoshis: string = '0') => {
    try {
      const z = BigInt(zatoshis);
      const isNeg = z < BigInt(0);
      const abs = isNeg ? -z : z;
      const whole = abs / BigInt(100000000);
      const frac = abs % BigInt(100000000);
      return `${isNeg ? '-' : ''}${whole}.${frac.toString().padStart(8, '0')}`;
    } catch {
      return '0.00000000';
    }
  };

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Detected Shielded Notes</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Decrypted via Incoming Viewing Key (IVK)
          </p>
        </div>
        <span className="badge badge-regtest">{notes.length} Note{notes.length === 1 ? '' : 's'}</span>
      </div>

      {notes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          No incoming notes detected in current scanning range.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.75rem 0.5rem' }}>Height</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Pool</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Amount</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>TxID</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Nullifier</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '0.75rem 0.5rem' }} className="mono-text">
                    #{note.height}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    <span className="badge badge-regtest" style={{ textTransform: 'uppercase' }}>
                      {note.pool || 'Orchard'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--accent-gold)' }} className="mono-text">
                    <strong>{zatoshisToZec(note.value)} ZEC</strong>
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem' }} className="mono-text">
                    {note.txid ? `${note.txid.slice(0, 10)}...${note.txid.slice(-8)}` : 'N/A'}
                  </td>
                  <td className="mono-text" style={{ padding: '0.75rem 0.5rem', fontSize: '0.75rem', opacity: 0.7 }}>
                    {note.nullifier ? `${note.nullifier.slice(0, 8)}...` : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
