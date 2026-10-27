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

  const totalZec = zatoshisToZec(accountData?.balances?.total || '0');
  const ironwoodZec = zatoshisToZec(accountData?.balances?.ironwood || accountData?.balances?.orchard || '0');
  const saplingZec = zatoshisToZec(accountData?.balances?.sapling || '0');
  const transparentZec = zatoshisToZec(accountData?.balances?.transparent || '0');

  // Upgrade name and branch ID directly from node
  const upgradeName = nodeInfo?.upgradeName || 'Unknown';
  const branchId = nodeInfo?.actualBranchId || nodeInfo?.consensusBranchId || 'Unknown';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
      {/* Account Balances Card */}
      <div className="glass-card" id="balance-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Shielded Balance</h2>
          <span className={`badge badge-${network}`}>{network}</span>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--accent-gold)' }}>
            {totalZec} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>ZEC</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Confirmed: {zatoshisToZec(accountData?.balances?.confirmed?.total || '0')} ZEC
            {accountData?.balances?.pending?.total !== '0' && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)' }}>
                (Pending: {zatoshisToZec(accountData?.balances?.pending?.total || '0')} ZEC)
              </span>
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
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Connected Node</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Block Height:</span>
            <strong className="mono-text">#{nodeInfo?.blockHeight || 'Syncing...'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Consensus Upgrade:</span>
            <strong style={{ color: 'var(--accent-gold)' }}>
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
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--accent-gold)' }}>
            {actionStatus}
          </div>
        )}
      </div>
    </div>
  );
};
