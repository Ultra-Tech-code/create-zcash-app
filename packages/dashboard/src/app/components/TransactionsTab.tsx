'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface TransactionsTabProps {
  notes?: any[];
  network?: string;
  preset?: string;
  account?: string;
  onNavigateTx?: (txid: string) => void;
}

export interface WalletTx {
  txid: string;
  minedHeight?: number;
  height?: number;
  txIndex?: number;
  direction: 'in' | 'out' | 'internal';
  valueZat?: number;
  value?: number;
  feeZat?: number | null;
  fee?: number | null;
  memo: string | null;
  counterparty: string | null;
  pool?: string;
}

interface SyncStatus {
  status: 'idle' | 'syncing' | 'synced' | 'error';
  scanned: number;
  target: number;
  notesFound: number;
  pendingFetches: number;
  failedFetches: number;
  error?: string;
  message?: string;
}

export const TransactionsTab: React.FC<TransactionsTabProps> = ({
  network = 'regtest',
  preset = 'regtest-nu7',
  account = 'account0',
  onNavigateTx,
}) => {
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    try {
      // 1. Fetch transactions (uses server-side session cookie automatically)
      const txRes = await fetch(`/api/transactions?network=${network}&preset=${preset}&account=${account}&limit=100`);
      const txData = await txRes.json();
      if (txData.success) {
        setTransactions(txData.transactions || []);
      } else {
        setError(txData.error || 'Failed to fetch transactions');
      }

      // 2. Fetch sync status
      const syncRes = await fetch(`/api/sync/status?network=${network}&account=${account}&preset=${preset}`);
      const syncData = await syncRes.json();
      if (syncData.success) {
        setSyncStatus(syncData);
      }
    } catch (err: any) {
      setError(err?.message || 'Error connecting to activity endpoints');
    } finally {
      setLoading(false);
    }
  }, [network, account, preset]);

  useEffect(() => {
    fetchActivity();
    const timer = setInterval(fetchActivity, 4000);
    return () => clearInterval(timer);
  }, [fetchActivity]);

  const zatToZec = (zat: number) => {
    const isNeg = zat < 0;
    const abs = Math.abs(zat);
    const whole = Math.floor(abs / 100_000_000);
    const frac = abs % 100_000_000;
    return `${isNeg ? '-' : ''}${whole}.${frac.toString().padStart(8, '0')}`;
  };

  const formatZat = (zat: number) => {
    return zat.toLocaleString('en-US');
  };

  const getDirectionBadge = (dir: string) => {
    switch (dir) {
      case 'in':
        return (
          <span
            className="badge"
            style={{
              background: 'rgba(52, 211, 153, 0.2)',
              color: 'var(--tx-in)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              fontWeight: 600,
              fontSize: '0.75rem',
              textTransform: 'uppercase',
            }}
          >
            IN
          </span>
        );
      case 'out':
        return (
          <span
            className="badge"
            style={{
              background: 'rgba(251, 191, 36, 0.2)',
              color: 'var(--tx-out)',
              border: '1px solid rgba(251, 191, 36, 0.4)',
              fontWeight: 600,
              fontSize: '0.75rem',
              textTransform: 'uppercase',
            }}
          >
            OUT
          </span>
        );
      case 'internal':
      default:
        return (
          <span
            className="badge"
            style={{
              background: 'rgba(56, 189, 248, 0.2)',
              color: 'var(--tx-internal)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              fontWeight: 600,
              fontSize: '0.75rem',
              textTransform: 'uppercase',
            }}
          >
            INTERNAL
          </span>
        );
    }
  };

  const currentScanned = syncStatus?.scanned || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Sync Status Banner */}
      <div className="glass-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Activity &amp; Transaction History</h2>
            {syncStatus && (
              <span
                id="sync-status-badge"
                className="badge"
                style={{
                  background:
                    syncStatus.status === 'syncing'
                      ? 'var(--alert-warning-bg)'
                      : syncStatus.status === 'synced'
                      ? 'var(--alert-success-bg)'
                      : syncStatus.status === 'error'
                      ? 'var(--alert-danger-bg)'
                      : 'var(--btn-secondary-bg)',
                  color:
                    syncStatus.status === 'syncing'
                      ? 'var(--color-warning)'
                      : syncStatus.status === 'synced'
                      ? 'var(--color-success)'
                      : syncStatus.status === 'error'
                      ? 'var(--color-danger)'
                      : 'var(--text-secondary)',
                  border: `1px solid ${
                    syncStatus.status === 'syncing'
                      ? 'var(--alert-warning-border)'
                      : syncStatus.status === 'synced'
                      ? 'var(--alert-success-border)'
                      : syncStatus.status === 'error'
                      ? 'var(--alert-danger-border)'
                      : 'var(--border-color)'
                  }`,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                }}
              >
                {syncStatus.status}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span id="sync-scanned-height">
              Scanned: <strong className="mono-text" style={{ color: 'var(--text-primary)' }}>{syncStatus?.scanned?.toLocaleString() || 0}</strong>
              {syncStatus?.target ? ` / ${syncStatus.target.toLocaleString()}` : ''}
            </span>
            <span id="sync-pending-fetches">
              Pending Fetches: <strong className="mono-text" style={{ color: syncStatus?.pendingFetches ? 'var(--accent-gold)' : 'var(--text-primary)' }}>{syncStatus?.pendingFetches || 0}</strong>
            </span>
            <span id="sync-failed-fetches">
              Failed Fetches: <strong className="mono-text" style={{ color: syncStatus?.failedFetches ? 'var(--accent-red)' : 'var(--text-primary)' }}>{syncStatus?.failedFetches || 0}</strong>
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        {syncStatus && syncStatus.target > 0 && (
          <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, Math.max(0, (syncStatus.scanned / syncStatus.target) * 100))}%`,
                height: '100%',
                background: syncStatus.status === 'synced' ? 'var(--accent-green)' : 'var(--accent-gold)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        )}
      </div>

      {/* Error state banner */}
      {error && (
        <div
          id="activity-error-banner"
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
          ⚠️ <strong>Activity Error:</strong> {error}
        </div>
      )}

      {/* Transactions Table or Empty State */}
      <div className="glass-card">
        {loading && transactions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Loading activity data...
          </div>
        ) : transactions.length === 0 ? (
          <div id="activity-empty-state" style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📭</div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
              No Transactions Found
            </h3>
            <p style={{ fontSize: '0.85rem', maxWidth: '420px', margin: '0 auto', lineHeight: '1.5' }}>
              {syncStatus?.message?.includes('UFVK required')
                ? 'No UFVK loaded. Import your Unified Full Viewing Key in the Keys tab to view decrypted transaction history.'
                : syncStatus?.status === 'syncing'
                ? 'Synchronization in progress. Mined transactions will appear here once relevant blocks are scanned.'
                : 'No incoming or outgoing transactions detected for this account in the scanned block range.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table id="table-transactions" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.825rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Direction</th>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Amount</th>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Memo</th>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Counterparty</th>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Height</th>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Confirmations</th>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Fee</th>
                  <th style={{ padding: '0.75rem 0.6rem' }}>Transaction ID</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx) => {
                  const txHeight = tx.height ?? (tx as any).minedHeight ?? 0;
                  const txValue = tx.value ?? (tx as any).valueZat ?? 0;
                  const txFee = tx.fee !== undefined ? tx.fee : (tx as any).feeZat;
                  const confirmations = currentScanned >= txHeight && txHeight > 0 ? currentScanned - txHeight + 1 : 1;
                  const feeDisplay = txFee !== null && txFee !== undefined ? `${zatToZec(txFee)} ZEC` : 'unknown';

                  return (
                    <tr
                      key={`${tx.txid}-${idx}`}
                      className="tx-row"
                      data-direction={tx.direction}
                      data-txid={tx.txid}
                      style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}
                    >
                      {/* Direction badge */}
                      <td style={{ padding: '0.75rem 0.6rem' }}>
                        {getDirectionBadge(tx.direction)}
                      </td>

                      {/* Amount: ZEC and zat */}
                      <td style={{ padding: '0.75rem 0.6rem' }} className="mono-text">
                        <div style={{ fontWeight: 600, color: tx.direction === 'in' ? 'var(--tx-in)' : tx.direction === 'out' ? 'var(--tx-out)' : 'var(--text-primary)' }}>
                          {tx.direction === 'in' ? '+' : tx.direction === 'out' ? '-' : ''}
                          {zatToZec(txValue)} ZEC
                        </div>
                        <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                          {formatZat(txValue)} zat
                        </div>
                      </td>

                      {/* Memo */}
                      <td style={{ padding: '0.75rem 0.6rem', maxWidth: '220px' }}>
                        {tx.memo ? (
                          <div
                            style={{
                              background: 'rgba(255, 255, 255, 0.04)',
                              padding: '0.35rem 0.55rem',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              lineHeight: '1.3',
                              wordBreak: 'break-word',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                            }}
                          >
                            &ldquo;{tx.memo}&rdquo;
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.75rem' }}>
                            None
                          </span>
                        )}
                      </td>

                      {/* Counterparty (outgoing) */}
                      <td style={{ padding: '0.75rem 0.6rem', maxWidth: '180px' }} className="mono-text">
                        {tx.counterparty ? (
                          <span
                            title={tx.counterparty}
                            style={{
                              display: 'inline-block',
                              maxWidth: '160px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {tx.counterparty}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>—</span>
                        )}
                      </td>

                      {/* Height */}
                      <td style={{ padding: '0.75rem 0.6rem' }} className="mono-text">
                        #{txHeight.toLocaleString()}
                      </td>

                      {/* Confirmations */}
                      <td style={{ padding: '0.75rem 0.6rem' }} className="mono-text">
                        <span style={{ color: confirmations >= 10 ? 'var(--color-success)' : 'var(--accent-primary)' }}>
                          {confirmations.toLocaleString()}
                        </span>
                      </td>

                      {/* Fee: "unknown" when null */}
                      <td style={{ padding: '0.75rem 0.6rem', color: 'var(--text-secondary)' }} className="mono-text">
                        {feeDisplay}
                      </td>

                      {/* TxID linked to Explorer */}
                      <td style={{ padding: '0.75rem 0.6rem' }} className="mono-text">
                        <Link
                          href={`/explorer/${tx.txid}?preset=${encodeURIComponent(preset)}&network=${encodeURIComponent(network)}`}
                          className="txid-link"
                          style={{
                            color: 'var(--accent-gold)',
                            textDecoration: 'none',
                            borderBottom: '1px dotted var(--accent-gold)',
                            fontSize: '0.75rem',
                          }}
                          title={`Inspect ${tx.txid} in Explorer`}
                          onClick={(e) => {
                            if (onNavigateTx && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                              e.preventDefault();
                              onNavigateTx(tx.txid);
                            }
                          }}
                        >
                          {tx.txid.slice(0, 8)}...{tx.txid.slice(-8)}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
