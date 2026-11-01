'use client';

import React from 'react';

interface ConsensusBannerProps {
  nodeInfo: {
    upgradeName?: string;
    actualBranchId?: string;
    expectedBranchId?: string;
    expectedUpgradeName?: string;
    branchMatches?: boolean;
    blockHeight?: string | number;
    chainMismatch?: boolean;
    chainMismatchMessage?: string;
  } | null;
  network: string;
}

export const ConsensusBanner: React.FC<ConsensusBannerProps> = ({ nodeInfo, network }) => {
  if (!nodeInfo || !nodeInfo.actualBranchId) {
    return null;
  }

  const {
    upgradeName = 'Unknown',
    actualBranchId = '',
    expectedBranchId = '',
    expectedUpgradeName = 'Unknown',
    branchMatches = false,
    blockHeight = 0,
    chainMismatch = false,
    chainMismatchMessage,
  } = nodeInfo;

  // Guard 1: Chain name mismatch precedes branch-id check
  if (chainMismatch && chainMismatchMessage) {
    return (
      <div
        id="consensus-banner-chain-mismatch"
        style={{
          padding: '0.875rem 1.25rem',
          background: 'var(--alert-danger-bg)',
          border: '1px solid var(--alert-danger-border)',
          borderRadius: '10px',
          marginBottom: '1.5rem',
          color: 'var(--alert-danger-text)',
          fontSize: '0.85rem',
          lineHeight: '1.5',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <span style={{ fontSize: '1.25rem' }}>🚫</span>
        <div>
          <strong>Chain Network Mismatch:</strong> {chainMismatchMessage}
        </div>
      </div>
    );
  }

  // Guard 2: Branch ID check
  if (!branchMatches && expectedBranchId) {
    return (
      <div
        id="consensus-banner-mismatch"
        style={{
          padding: '0.875rem 1.25rem',
          background: 'var(--alert-danger-bg)',
          border: '1px solid var(--alert-danger-border)',
          borderRadius: '10px',
          marginBottom: '1.5rem',
          color: 'var(--alert-danger-text)',
          fontSize: '0.85rem',
          lineHeight: '1.5',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
        }}
      >
        <span style={{ fontSize: '1.25rem' }}>⚠️</span>
        <div>
          <div>
            <strong>Consensus Branch ID Mismatch:</strong> Connected node at height #{blockHeight} reports branch ID{' '}
            <code className="mono-text">0x{actualBranchId}</code> (<strong>{upgradeName}</strong>), but expected branch ID for {network} is{' '}
            <code className="mono-text">0x{expectedBranchId}</code> (<strong>{expectedUpgradeName}</strong>).
            The node may be syncing an alternate chain or running differing consensus activation heights.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      id="consensus-banner-verified"
      style={{
        padding: '0.75rem 1.25rem',
        background: 'var(--alert-success-bg)',
        border: '1px solid var(--alert-success-border)',
        borderRadius: '10px',
        marginBottom: '1.5rem',
        color: 'var(--alert-success-text)',
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>✓</span>
        <span>
          <strong>Consensus Verified:</strong> Active Upgrade <strong>{upgradeName}</strong> (<code className="mono-text">0x{actualBranchId}</code>) matches expected rules at height #{blockHeight}.
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>
        Network: <span style={{ textTransform: 'capitalize' }}>{network}</span>
      </div>
    </div>
  );
};
