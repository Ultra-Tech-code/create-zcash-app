'use client';

import React, { useState } from 'react';

interface AddressesTabProps {
  accountData: any;
  activeAccountIndex: number;
  onSelectAccountIndex: (index: number) => void;
  network: string;
}

export const AddressesTab: React.FC<AddressesTabProps> = ({
  accountData,
  activeAccountIndex,
  onSelectAccountIndex,
  network,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [mainnetUfvkConfirmed, setMainnetUfvkConfirmed] = useState<boolean>(false);
  const [showMainnetDialog, setShowMainnetDialog] = useState<boolean>(false);

  const copyToClipboard = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const isWatchOnly = network !== 'regtest';
  const isMainnet = network === 'mainnet';
  const ufvk = accountData?.ufvk || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {accountData?.status === 'error' && (
        <div
          id="addresses-error-banner"
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '8px',
            color: '#fca5a5',
            fontSize: '0.85rem',
            lineHeight: '1.5',
          }}
        >
          ⚠️ <strong>Account Error:</strong> {accountData.message}
        </div>
      )}

      {/* Account Selector */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Active Account</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {isWatchOnly
              ? `Watch-Only Account (${network === 'mainnet' ? 'Mainnet' : 'Testnet'})`
              : `BIP-39 Test Fixture Account #${activeAccountIndex} (${network})`}
          </p>
        </div>
        {!isWatchOnly && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[0, 1, 2].map((idx) => (
              <button
                key={idx}
                className={idx === activeAccountIndex ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                onClick={() => onSelectAccountIndex(idx)}
              >
                Account #{idx}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Unified Address */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Unified Address (UA)</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Shielded receiver combining Orchard/Ironwood, Sapling, and Transparent receivers
            </p>
          </div>
          <button
            className="btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
            onClick={() => copyToClipboard(accountData?.unifiedAddress || '', 'ua')}
          >
            {copiedField === 'ua' ? '✓ Copied' : 'Copy UA'}
          </button>
        </div>
        <div
          className="mono-text"
          style={{
            background: 'rgba(0, 0, 0, 0.3)',
            padding: '0.75rem',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            fontSize: '0.8rem',
            lineHeight: '1.4',
            wordBreak: 'break-all',
          }}
        >
          {accountData?.unifiedAddress ||
            (isWatchOnly
              ? `Watch-only mode on ${network}. Paste a Unified Full Viewing Key (UFVK) to view address and history.`
              : 'Loading...')}
        </div>
      </div>

      {/* Transparent Address */}
      {accountData?.transparentAddress && (
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Transparent Address (t-addr)</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Legacy transparent component of this unified account
              </p>
            </div>
            <button
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
              onClick={() => copyToClipboard(accountData?.transparentAddress || '', 'taddr')}
            >
              {copiedField === 'taddr' ? '✓ Copied' : 'Copy t-addr'}
            </button>
          </div>
          <div
            className="mono-text"
            style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              fontSize: '0.8rem',
            }}
          >
            {accountData?.transparentAddress}
          </div>
        </div>
      )}

      {/* Unified Full Viewing Key (UFVK) */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Unified Full Viewing Key (UFVK)</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Read-only authority allowing transaction detection and balance queries without spending capability
            </p>
          </div>
          {(!isMainnet || mainnetUfvkConfirmed) && ufvk && (
            <button
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
              onClick={() => copyToClipboard(ufvk, 'ufvk')}
            >
              {copiedField === 'ufvk' ? '✓ Copied' : 'Copy UFVK'}
            </button>
          )}
        </div>

        {isMainnet && !mainnetUfvkConfirmed ? (
          <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px' }}>
            <p style={{ fontSize: '0.85rem', color: '#fca5a5', marginBottom: '0.75rem' }}>
              🔒 <strong>Mainnet Privacy Notice:</strong> A Unified Full Viewing Key allows anyone who possesses it to inspect the complete incoming and outgoing transaction history of this account.
            </p>
            <button
              className="btn-primary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              onClick={() => setShowMainnetDialog(true)}
            >
              Reveal UFVK
            </button>
          </div>
        ) : (
          <div
            className="mono-text"
            style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              fontSize: '0.75rem',
              lineHeight: '1.4',
            }}
          >
            {ufvk || 'No UFVK loaded'}
          </div>
        )}
      </div>

      {/* Mainnet Reveal Confirmation Modal */}
      {showMainnetDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div className="glass-card" style={{ maxWidth: '480px', margin: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent-red)', marginBottom: '0.75rem' }}>
              Confirm UFVK Reveal
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: '1.5' }}>
              Anyone holding this Unified Full Viewing Key can decrypt and observe all transaction amounts, timestamps, and note details for this account across the entire history of the Zcash blockchain.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button className="btn-secondary" onClick={() => setShowMainnetDialog(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setMainnetUfvkConfirmed(true);
                  setShowMainnetDialog(false);
                }}
              >
                I Understand, Show UFVK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
