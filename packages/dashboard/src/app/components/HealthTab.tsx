'use client';

import React from 'react';
import { PresetId, NETWORK_PRESETS } from '../endpoints';

interface HealthTabProps {
  preset: PresetId;
  nodeInfo: any;
  isConnected: boolean;
  endpoint: string;
}

export const HealthTab: React.FC<HealthTabProps> = ({
  preset,
  nodeInfo,
  isConnected,
  endpoint,
}) => {
  const presetConfig = NETWORK_PRESETS[preset];
  const network = presetConfig?.network || 'regtest';
  const upgradeName = nodeInfo?.upgradeName || 'Unknown';
  const actualBranchId = nodeInfo?.actualBranchId || nodeInfo?.consensusBranchId || 'Unknown';
  const expectedBranchId = nodeInfo?.expectedBranchId || 'Unknown';
  const branchMatches = nodeInfo?.branchMatches ?? false;

  const nodeSync = nodeInfo?.nodeSync || nodeInfo;
  const syncState = nodeSync?.syncState || (network === 'regtest' ? 'regtest' : 'unknown');
  const syncPercent = nodeSync?.syncPercent ?? null;
  const blocks = nodeSync?.blocks ?? nodeInfo?.blockHeight ?? null;
  const headers = nodeSync?.headers ?? null;
  const estimatedHeight = nodeSync?.estimatedHeight ?? null;
  const verificationProgress = nodeSync?.verificationProgress ?? null;
  const indexerBehind = nodeSync?.indexerBehind ?? null;
  const indexerBehindMessage = nodeSync?.indexerBehindMessage ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="glass-card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Service Health & Indexer Diagnostics</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Real-time consensus and protocol health checks for the active connection.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {/* Connection Status */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Connection Status
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: isConnected ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {isConnected ? '● Connected' : '○ Offline'}
            </div>
            <div className="mono-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {endpoint}
            </div>
          </div>

          {/* Consensus Verification */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Consensus Branch Verification
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: branchMatches ? 'var(--accent-green)' : 'var(--accent-gold)' }}>
              {branchMatches ? '✓ Verified' : '⚠️ Unverified / Mismatch'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Actual: <code className="mono-text">0x{actualBranchId}</code> ({upgradeName})
            </div>
          </div>

          {/* Block Height */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Block Height
            </div>
            <div className="mono-text" style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent-gold)' }}>
              #{nodeInfo?.blockHeight || 'N/A'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Estimated: #{nodeInfo?.estimatedHeight || nodeInfo?.blockHeight || 'N/A'}
            </div>
          </div>

          {/* Protocol Version */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Lightwalletd Protocol
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
              {nodeInfo?.lightwalletProtocolVersion || nodeInfo?.version || 'v0.5.0'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Vendor: {nodeInfo?.vendor || 'Unknown'}
            </div>
          </div>
        </div>
      </div>

      {/* Node Sync Diagnostic Card */}
      <div className="glass-card" id="node-sync-diagnostic-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Node Sync Diagnostic</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Direct Zebra node sync metrics via JSON-RPC (<code className="mono-text">getblockchaininfo</code>)
            </p>
          </div>
          <span
            id="health-sync-state-badge"
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

        {/* Sync Progress Indicator */}
        <div
          style={{
            padding: '1rem',
            background: 'var(--btn-secondary-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Calculated Sync Progress</span>
            <span
              id="health-sync-percent"
              style={{
                fontSize: '1.25rem',
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

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span>
              {syncState === 'regtest'
                ? `Height: #${blocks ?? nodeInfo?.blockHeight ?? '0'}`
                : estimatedHeight
                ? `~${blocks ?? nodeInfo?.blockHeight ?? 0} / ~${estimatedHeight} (estimated tip)`
                : `Height: #${blocks ?? nodeInfo?.blockHeight ?? 'N/A'}`}
            </span>
            {indexerBehindMessage && (
              <span id="health-indexer-lag" style={{ color: indexerBehind === 0 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {indexerBehindMessage}
              </span>
            )}
          </div>
        </div>

        {/* Raw Fields & Lag Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Zebra blocks</div>
            <div className="mono-text" style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.2rem' }}>
              {blocks !== null ? blocks.toLocaleString() : 'N/A'}
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Zebra headers</div>
            <div className="mono-text" style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.2rem' }}>
              {headers !== null ? headers.toLocaleString() : 'N/A'}
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>estimated_height</div>
            <div className="mono-text" style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.2rem' }}>
              {estimatedHeight !== null ? estimatedHeight.toLocaleString() : 'N/A'}
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>verification_progress</div>
            <div className="mono-text" style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.2rem' }}>
              {verificationProgress !== null ? verificationProgress.toFixed(6) : 'N/A'}
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Indexer Lag</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.2rem', color: indexerBehind === 0 ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {indexerBehind !== null ? `${indexerBehind} block${indexerBehind === 1 ? '' : 's'}` : 'N/A'}
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Node RPC URL</div>
            <div className="mono-text" style={{ fontSize: '0.75rem', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nodeSync?.nodeRpcUrl || 'Default'}>
              {nodeSync?.nodeRpcUrl || 'Default'}
            </div>
          </div>
        </div>
      </div>

      {/* Details Table */}
      <div className="glass-card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Detailed Node Parameters</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '0.6rem 0', color: 'var(--text-secondary)' }}>Selected Preset</td>
              <td style={{ padding: '0.6rem 0', fontWeight: 500 }}>{presetConfig?.label}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '0.6rem 0', color: 'var(--text-secondary)' }}>Node Subversion</td>
              <td style={{ padding: '0.6rem 0' }} className="mono-text">{nodeInfo?.zcashdSubversion || 'N/A'}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '0.6rem 0', color: 'var(--text-secondary)' }}>Active Branch ID</td>
              <td style={{ padding: '0.6rem 0' }} className="mono-text">0x{actualBranchId}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '0.6rem 0', color: 'var(--text-secondary)' }}>Expected Branch ID for Height</td>
              <td style={{ padding: '0.6rem 0' }} className="mono-text">0x{expectedBranchId}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '0.6rem 0', color: 'var(--text-secondary)' }}>Transparent Address Indexing</td>
              <td style={{ padding: '0.6rem 0' }}>{nodeInfo?.taddrSupport ? 'Supported' : 'Disabled'}</td>
            </tr>
            <tr>
              <td style={{ padding: '0.6rem 0', color: 'var(--text-secondary)' }}>Sapling Activation Height</td>
              <td style={{ padding: '0.6rem 0' }} className="mono-text">#{nodeInfo?.saplingActivationHeight || '1'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
