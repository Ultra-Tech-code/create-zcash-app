'use client';

import React from 'react';
import { PresetId } from '../endpoints';

interface OverviewTabProps {
  accountData: any;
  nodeInfo: any;
  preset: PresetId;
  network: string;
  onMine: (blocks?: number) => void;
  onFund: () => void;
  actionStatus: string;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  accountData,
  nodeInfo,
  preset,
  network,
  onMine,
  onFund,
  actionStatus,
}) => {
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

  const isNu7Regtest = preset === 'regtest-nu7';
  const isWatchOnly = network !== 'regtest';
  const isError = accountData?.status === 'error';
  const isSyncing = accountData?.status === 'syncing';

  const totalZec = isError
    ? '—'
    : isWatchOnly && !accountData?.balances
    ? '—'
    : zatoshisToZec(accountData?.balances?.total || '0');

  const ironwoodZec = isError || !accountData?.balances
    ? '—'
    : zatoshisToZec(accountData?.balances?.ironwood || accountData?.balances?.orchard || '0');

  const saplingZec = isError || !accountData?.balances
    ? '—'
    : zatoshisToZec(accountData?.balances?.sapling || '0');

  const transparentZec = isError || !accountData?.balances
    ? '—'
    : zatoshisToZec(accountData?.balances?.transparent || '0');

  // Upgrade name and branch ID directly from node
  const upgradeName = nodeInfo?.upgradeName || 'Unknown';
  const branchId = nodeInfo?.actualBranchId || nodeInfo?.consensusBranchId || 'Unknown';

  // Node sync status
  const syncState = nodeInfo?.syncState || nodeInfo?.nodeSync?.syncState || (network === 'regtest' ? 'regtest' : 'unknown');
  const syncPercent = nodeInfo?.syncPercent ?? nodeInfo?.nodeSync?.syncPercent ?? null;
  const blocks = nodeInfo?.blocks ?? nodeInfo?.nodeSync?.blocks ?? nodeInfo?.blockHeight ?? null;
  const estimatedHeight = nodeInfo?.estimatedHeight ?? nodeInfo?.nodeSync?.estimatedHeight ?? null;
  const indexerBehind = nodeInfo?.indexerBehind ?? nodeInfo?.nodeSync?.indexerBehind ?? null;
  const indexerBehindMessage = nodeInfo?.indexerBehindMessage ?? nodeInfo?.nodeSync?.indexerBehindMessage ?? null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
      {/* Account Balances Card */}
      <div className="glass-card" id="balance-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Shielded Balance</h2>
          <span className={`badge badge-${network}`}>{network}</span>
        </div>

        {isError && (
          <div
            id="account-error-banner"
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--alert-danger-bg)',
              border: '1px solid var(--alert-danger-border)',
              borderRadius: '8px',
              color: 'var(--alert-danger-text)',
              fontSize: '0.85rem',
              lineHeight: '1.5',
              marginBottom: '1rem',
            }}
          >
            ⚠️ <strong>Account Query Error:</strong> {accountData.message}
          </div>
        )}

        {isSyncing && (
          <div
            id="account-syncing-banner"
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--alert-info-bg)',
              border: '1px solid var(--alert-info-border)',
              borderRadius: '8px',
              color: 'var(--alert-info-text)',
              fontSize: '0.85rem',
              lineHeight: '1.5',
              marginBottom: '1rem',
            }}
          >
            🔄 <strong>Node Syncing:</strong> {accountData.message}
          </div>
        )}

        {isWatchOnly && !accountData?.ufvk && !isError && (
          <div
            id="watch-only-banner"
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--alert-info-bg)',
              border: '1px solid var(--alert-info-border)',
              borderRadius: '8px',
              color: 'var(--alert-info-text)',
              fontSize: '0.85rem',
              lineHeight: '1.5',
              marginBottom: '1rem',
            }}
          >
            🔒 <strong>Watch-Only:</strong> {accountData?.message || `${network} operates watch-only. Paste a UFVK to view balance.`}
          </div>
        )}

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--accent-primary)' }}>
            {totalZec} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>ZEC</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {isError ? (
              <span style={{ color: 'var(--alert-danger-text)' }}>Balance unavailable (error connecting to node)</span>
            ) : isWatchOnly && !accountData?.balances ? (
              <span>Import a Unified Full Viewing Key (UFVK) to scan balances</span>
            ) : (
              <>
                Confirmed: {zatoshisToZec(accountData?.balances?.confirmed?.total || '0')} ZEC
                {accountData?.balances?.pending?.total && accountData.balances.pending.total !== '0' && (
                  <span style={{ marginLeft: '0.5rem', color: 'var(--accent-secondary)' }}>
                    (Pending: {zatoshisToZec(accountData?.balances?.pending?.total || '0')} ZEC)
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pool Distribution
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Orchard / Ironwood (Shielded):</span>
              <strong className="mono-text">{ironwoodZec} ZEC</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Sapling (Shielded):</span>
              <strong className="mono-text">{saplingZec} ZEC</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Transparent Pool:</span>
              <strong className="mono-text">{transparentZec} ZEC</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Node Status Card */}
      <div className="glass-card" id="node-status-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Connected Node</h2>
          <span
            id="node-sync-badge"
            className="badge"
            style={{
              background:
                syncState === 'synced'
                  ? 'var(--badge-regtest-bg)'
                  : syncState === 'syncing'
                  ? 'var(--alert-warning-bg)'
                  : syncState === 'regtest'
                  ? 'var(--btn-secondary-bg)'
                  : 'var(--alert-warning-bg)',
              color:
                syncState === 'synced'
                  ? 'var(--color-success)'
                  : syncState === 'syncing'
                  ? 'var(--color-warning)'
                  : syncState === 'regtest'
                  ? 'var(--text-secondary)'
                  : 'var(--color-warning)',
              border: `1px solid ${
                syncState === 'synced'
                  ? 'var(--badge-regtest-border)'
                  : syncState === 'syncing'
                  ? 'var(--alert-warning-border)'
                  : syncState === 'regtest'
                  ? 'var(--border-color)'
                  : 'var(--alert-warning-border)'
              }`,
            }}
          >
            {syncState === 'synced'
              ? 'Synced'
              : syncState === 'syncing'
              ? `Syncing${syncPercent !== null ? ` ~${syncPercent}%` : ''}`
              : syncState === 'regtest'
              ? 'Regtest'
              : 'Unknown'}
          </span>
        </div>

        {/* Sync Progress Box */}
        <div
          id="sync-progress-box"
          style={{
            padding: '1rem',
            background: 'var(--btn-secondary-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Node Sync Progress
            </span>
            <span
              id="sync-percentage-text"
              style={{
                fontSize: '1.35rem',
                fontWeight: 700,
                color:
                  syncState === 'synced'
                    ? 'var(--color-success)'
                    : syncState === 'syncing'
                    ? 'var(--color-warning)'
                    : 'var(--text-secondary)',
              }}
            >
              {syncState === 'regtest'
                ? 'n/a on regtest'
                : syncPercent !== null
                ? `~${syncPercent}%`
                : 'Sync progress unavailable'}
            </span>
          </div>

          {(syncState === 'synced' || syncState === 'syncing') && syncPercent !== null && (
            <div className="sync-progress-bar">
              <div
                className="sync-progress-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, syncPercent))}%`,
                  background:
                    syncState === 'synced'
                      ? 'var(--progress-fill-synced)'
                      : 'var(--progress-fill-syncing)',
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span>
              {syncState === 'regtest' ? (
                <>Height #{blocks ?? nodeInfo?.blockHeight ?? '0'}</>
              ) : estimatedHeight ? (
                <>~{blocks ?? nodeInfo?.blockHeight ?? 0} / ~{estimatedHeight} (estimated tip)</>
              ) : (
                <>Height #{blocks ?? nodeInfo?.blockHeight ?? 'N/A'}</>
              )}
            </span>
            {indexerBehindMessage && (
              <span id="indexer-status-msg" style={{ color: indexerBehind === 0 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {indexerBehindMessage}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Block Height:</span>
            <strong className="mono-text">#{nodeInfo?.blockHeight || 'Syncing...'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Consensus Upgrade:</span>
            <strong style={{ color: 'var(--accent-primary)' }}>
              {upgradeName} <span className="mono-text" style={{ fontSize: '0.8rem', opacity: 0.8 }}>(0x{branchId})</span>
            </strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Node Software:</span>
            <span>{nodeInfo?.zcashdSubversion || nodeInfo?.vendor || 'Unknown'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Protocol Version:</span>
            <span className="mono-text">{nodeInfo?.version || nodeInfo?.lightwalletProtocolVersion || 'v0.5.0'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Chain Identity:</span>
            <span style={{ textTransform: 'capitalize' }}>{nodeInfo?.chainName || network}</span>
          </div>
        </div>

        {/* Quick Developer Actions */}
        {!isWatchOnly && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Developer Controls ({isNu7Regtest ? 'NU7 Regtest' : 'Z3 Regtest'}):
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }} onClick={() => onMine(1)}>
                Mine 1 Block
              </button>
              <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }} onClick={() => onMine(10)}>
                Mine 10 Blocks
              </button>
              {!isNu7Regtest ? (
                <button className="btn-primary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }} onClick={onFund}>
                  Fund 1 ZEC
                </button>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                  (Zallet fund disabled on pure Zebra NU7)
                </span>
              )}
            </div>
          </div>
        )}

        {actionStatus && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--accent-primary)' }}>
            {actionStatus}
          </div>
        )}
      </div>
    </div>
  );
};
