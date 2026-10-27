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
  const upgradeName = nodeInfo?.upgradeName || 'Unknown';
  const actualBranchId = nodeInfo?.actualBranchId || nodeInfo?.consensusBranchId || 'Unknown';
  const expectedBranchId = nodeInfo?.expectedBranchId || 'Unknown';
  const branchMatches = nodeInfo?.branchMatches ?? false;

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
