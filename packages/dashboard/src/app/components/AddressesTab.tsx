'use client';

import React, { useState } from 'react';

interface AddressesTabProps {
  accountData: any;
  activeAccountIndex: number;
  onSelectAccountIndex: (index: number) => void;
  network: string;
  onRefresh?: () => void;
}

export const AddressesTab: React.FC<AddressesTabProps> = ({
  accountData,
  activeAccountIndex,
  onSelectAccountIndex,
  network,
  onRefresh,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [showMainnetDialog, setShowMainnetDialog] = useState<boolean>(false);

  // Import form state
  const [importUfvk, setImportUfvk] = useState<string>('');
  const [importBirthday, setImportBirthday] = useState<string>('');
  const [importSubmitting, setImportSubmitting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');
  const [importSuccess, setImportSuccess] = useState<string>('');

  // Forget key state
  const [forgetSubmitting, setForgetSubmitting] = useState<boolean>(false);

  const copyToClipboard = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const isWatchOnly = network !== 'regtest';
  const isMainnet = network === 'mainnet';
  const ufvk = accountData?.ufvk || '';
  const hasImportedKey = Boolean(accountData?.hasImportedKey || ufvk);

  const handleRevealClick = () => {
    if (isRevealed) {
      setIsRevealed(false);
      return;
    }
    if (isMainnet) {
      setShowMainnetDialog(true);
    } else {
      setIsRevealed(true);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError('');
    setImportSuccess('');

    const trimmedUfvk = importUfvk.trim();
    if (!trimmedUfvk) {
      setImportError('UFVK is required');
      return;
    }

    if (!importBirthday.trim()) {
      setImportError('Birthday height is required on import');
      return;
    }

    const bHeight = parseInt(importBirthday.trim(), 10);
    if (isNaN(bHeight) || bHeight < 0) {
      setImportError('Birthday height must be a non-negative integer');
      return;
    }

    // Client-side prefix validation
    if (network === 'mainnet' && !trimmedUfvk.startsWith('uview1')) {
      setImportError(`Invalid UFVK prefix for mainnet: expected key starting with 'uview1'`);
      return;
    }
    if (network === 'testnet' && !trimmedUfvk.startsWith('uviewtest1')) {
      setImportError(`Invalid UFVK prefix for testnet: expected key starting with 'uviewtest1'`);
      return;
    }
    if (network === 'regtest' && !trimmedUfvk.startsWith('uviewregtest1')) {
      setImportError(`Invalid UFVK prefix for regtest: expected key starting with 'uviewregtest1'`);
      return;
    }

    setImportSubmitting(true);
    try {
      // SECURITY: Import UFVK strictly via POST body. NEVER via query parameters or GET.
      const res = await fetch('/api/account/import-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ufvk: trimmedUfvk,
          birthday: bHeight,
          network,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setImportSuccess('UFVK imported successfully into server-side session');
        setImportUfvk('');
        setImportBirthday('');
        setIsRevealed(false);
        if (onRefresh) onRefresh();
      } else {
        setImportError(data.error || 'Failed to import UFVK');
      }
    } catch (err: any) {
      setImportError(err.message || 'Network error during UFVK import');
    } finally {
      setImportSubmitting(false);
    }
  };

  const handleForgetKey = async () => {
    setForgetSubmitting(true);
    setImportError('');
    setImportSuccess('');
    try {
      const res = await fetch('/api/account/forget-key', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setImportSuccess('Key forgotten and server-side session cleared');
        setIsRevealed(false);
        if (onRefresh) onRefresh();
      } else {
        setImportError(data.error || 'Failed to clear session');
      }
    } catch (err: any) {
      setImportError(err.message || 'Error forgetting key');
    } finally {
      setForgetSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {accountData?.status === 'error' && (
        <div
          id="addresses-error-banner"
          style={{
            padding: '0.75rem 1rem',
            background: 'var(--alert-danger-bg)',
            border: '1px solid var(--alert-danger-border)',
            borderRadius: '8px',
            color: 'var(--alert-danger-text)',
            fontSize: '0.85rem',
            lineHeight: '1.5',
          }}
        >
          ⚠️ <strong>Account Error:</strong> {accountData.message}
        </div>
      )}

      {/* Account Info Bar */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Active Account Keys & Addresses</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {isWatchOnly
              ? `Watch-Only Account (${network === 'mainnet' ? 'Mainnet' : 'Testnet'}) - Viewing Keys Only`
              : `BIP-39 Test Fixture Account #${activeAccountIndex} (${network})`}
          </p>
        </div>
        {!isWatchOnly && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[0, 1, 2].map((idx) => (
              <button
                key={idx}
                id={`btn-account-${idx}`}
                className={idx === activeAccountIndex ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                onClick={() => onSelectAccountIndex(idx)}
              >
                Account #{idx}
              </button>
            ))}
          </div>
        )}
        {hasImportedKey && (
          <button
            id="btn-forget-key"
            className="btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', borderColor: 'var(--alert-danger-border)', color: 'var(--alert-danger-text)' }}
            disabled={forgetSubmitting}
            onClick={handleForgetKey}
          >
            {forgetSubmitting ? 'Clearing...' : '🗑️ Forget Key'}
          </button>
        )}
      </div>

      {/* Import UFVK Form (Watch-only or Manual Key Import) */}
      <div className="glass-card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.35rem' }}>
          Import Unified Full Viewing Key (UFVK)
        </h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Import an explicit watch-only UFVK via secure POST. Stored strictly in temporary server session memory. Spending keys and mnemonics are never accepted.
        </p>

        {importError && (
          <div
            id="import-error-banner"
            style={{
              padding: '0.6rem 0.85rem',
              background: 'var(--alert-danger-bg)',
              border: '1px solid var(--alert-danger-border)',
              borderRadius: '6px',
              color: 'var(--alert-danger-text)',
              fontSize: '0.8rem',
              marginBottom: '1rem',
            }}
          >
            ⚠️ {importError}
          </div>
        )}

        {importSuccess && (
          <div
            id="import-success-banner"
            style={{
              padding: '0.6rem 0.85rem',
              background: 'var(--alert-success-bg)',
              border: '1px solid var(--alert-success-border)',
              borderRadius: '6px',
              color: 'var(--alert-success-text)',
              fontSize: '0.8rem',
              marginBottom: '1rem',
            }}
          >
            ✓ {importSuccess}
          </div>
        )}

        <form onSubmit={handleImportSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <label htmlFor="input-ufvk" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
              Unified Full Viewing Key ({network === 'mainnet' ? 'uview1...' : network === 'testnet' ? 'uviewtest1...' : 'uviewregtest1...'}):
            </label>
            <textarea
              id="input-ufvk"
              rows={3}
              className="mono-text"
              placeholder={`Paste ${network} UFVK...`}
              value={importUfvk}
              onChange={(e) => setImportUfvk(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '6px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label htmlFor="input-birthday" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                Wallet Birthday Height (Required):
              </label>
              <input
                id="input-birthday"
                type="number"
                min="0"
                placeholder="e.g. 4542200"
                value={importBirthday}
                onChange={(e) => setImportBirthday(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            <button
              id="btn-import-key"
              type="submit"
              className="btn-primary"
              disabled={importSubmitting}
              style={{ padding: '0.55rem 1.25rem', fontSize: '0.85rem' }}
            >
              {importSubmitting ? 'Importing Key...' : '📥 Import UFVK via POST'}
            </button>
          </div>
        </form>
      </div>

      {/* Unified Address (UA) */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Unified Address (UA)</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Shielded receiver combining Orchard/Ironwood, Sapling, and Transparent receivers
            </p>
          </div>
          {accountData?.unifiedAddress && (
            <button
              id="btn-copy-ua"
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
              onClick={() => copyToClipboard(accountData?.unifiedAddress || '', 'ua')}
            >
              {copiedField === 'ua' ? '✓ Copied' : '📋 Copy UA'}
            </button>
          )}
        </div>
        <div
          id="address-ua"
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
              ? `Watch-only mode on ${network}. Import a Unified Full Viewing Key (UFVK) above to view address.`
              : 'Loading address...')}
        </div>
      </div>

      {/* Transparent Address (t-addr) */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Transparent Address (t-addr)</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Transparent component derived from the account's viewing key
            </p>
          </div>
          {accountData?.transparentAddress && (
            <button
              id="btn-copy-taddr"
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
              onClick={() => copyToClipboard(accountData?.transparentAddress || '', 'taddr')}
            >
              {copiedField === 'taddr' ? '✓ Copied' : '📋 Copy Transparent Address'}
            </button>
          )}
        </div>
        <div
          id="address-taddr"
          className="mono-text"
          style={{
            background: 'rgba(0, 0, 0, 0.3)',
            padding: '0.75rem',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            fontSize: '0.8rem',
            wordBreak: 'break-all',
          }}
        >
          {accountData?.transparentAddress || (hasImportedKey ? 'No transparent receiver derived' : 'Import UFVK above to derive transparent address')}
        </div>
      </div>

      {/* Unified Full Viewing Key (UFVK) - Collapsed behind Reveal */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Unified Full Viewing Key (UFVK)</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Read-only authority allowing note detection and balance queries without spending capability
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {hasImportedKey && (
              <button
                id="btn-reveal-ufvk"
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
                onClick={handleRevealClick}
              >
                {isRevealed ? '🔒 Hide UFVK' : '👁️ Reveal UFVK'}
              </button>
            )}
            {isRevealed && ufvk && (
              <button
                id="btn-copy-ufvk"
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
                onClick={() => copyToClipboard(ufvk, 'ufvk')}
              >
                {copiedField === 'ufvk' ? '✓ Copied' : '📋 Copy UFVK'}
              </button>
            )}
          </div>
        </div>

        {!hasImportedKey ? (
          <div style={{ padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            No UFVK loaded. Import your key above to inspect transactions.
          </div>
        ) : !isRevealed ? (
          <div
            id="ufvk-collapsed-container"
            style={{
              padding: '1rem',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '6px',
              border: '1px dashed var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span>🔒 UFVK is collapsed to protect privacy. Click &quot;Reveal UFVK&quot; to inspect.</span>
          </div>
        ) : (
          <div
            id="ufvk-revealed-text"
            className="mono-text"
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              padding: '0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              fontSize: '0.75rem',
              lineHeight: '1.4',
              wordBreak: 'break-all',
              color: 'var(--accent-gold)',
            }}
          >
            {ufvk}
          </div>
        )}
      </div>

      {/* Mainnet Reveal Confirmation Modal */}
      {showMainnetDialog && (
        <div
          id="mainnet-reveal-modal"
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
              Confirm UFVK Reveal on Mainnet
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: '1.5' }}>
              Anyone holding this Unified Full Viewing Key can decrypt and observe all transaction amounts, timestamps, and note details for this account across the entire history of the Zcash blockchain.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                id="btn-cancel-reveal"
                className="btn-secondary"
                onClick={() => setShowMainnetDialog(false)}
              >
                Cancel
              </button>
              <button
                id="btn-confirm-reveal"
                className="btn-primary"
                onClick={() => {
                  setIsRevealed(true);
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
