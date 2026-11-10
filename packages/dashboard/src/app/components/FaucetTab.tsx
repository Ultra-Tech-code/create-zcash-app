'use client';

import React from 'react';
import { PresetId } from '../endpoints';

interface FaucetTabProps {
  preset: PresetId;
  network: string;
  accountData: any;
  onMine: (blocks?: number) => void;
  onFund: () => void;
  actionStatus: string;
}

export const FaucetTab: React.FC<FaucetTabProps> = ({
  preset,
  network,
  accountData,
  onMine,
  onFund,
  actionStatus,
}) => {
  const isFullRegtest = preset === 'regtest-full';
  const isRegtest = network === 'regtest';
  const isWatchOnly = !isRegtest;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Block Mining Card */}
      <div className="glass-card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Regtest Block Generation</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          {isRegtest
            ? 'Calls Zebra generate RPC on 127.0.0.1:39232 directly. Mining coinbase rewards are paid to Account 0.'
            : 'Mining is only available on local regtest networks.'}
        </p>

        {!isWatchOnly ? (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              id="mine-1-block-btn"
              className="btn-primary"
              onClick={() => onMine(1)}
            >
              Mine 1 Block
            </button>
            <button
              id="mine-10-blocks-btn"
              className="btn-secondary"
              onClick={() => onMine(10)}
            >
              Mine 10 Blocks
            </button>
          </div>
        ) : (
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            ⚠️ Block mining disabled on {network}.
          </div>
        )}
      </div>

      {/* Account Funding Card */}
      <div className="glass-card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Account Funding</h2>

        {isFullRegtest ? (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Transfers 1.0 ZEC from Zallet regtest wallet to the active account and auto-mines 1 block to confirm.
            </p>
            <button
              id="fund-account-btn"
              className="btn-primary"
              onClick={onFund}
              disabled={!accountData?.unifiedAddress}
            >
              Fund 1.0 ZEC to Current Account
            </button>
          </div>
        ) : isRegtest ? (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Transfers 1.0 ZEC from Account 0 miner balance via the TypeScript SDK send pipeline to the active account.
            </p>
            <button
              id="fund-account-btn"
              className="btn-primary"
              onClick={onFund}
              disabled={!accountData?.unifiedAddress}
            >
              Fund 1.0 ZEC to Current Account
            </button>
          </div>
        ) : (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            To get testnet funds on {network}, use the community testnet faucet at{' '}
            <a
              href="https://faucet.zecpages.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-gold)', textDecoration: 'underline' }}
            >
              faucet.zecpages.com
            </a>{' '}
            or the Zcash community discord testnet faucet.
          </div>
        )}

        {actionStatus && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--accent-gold)' }}>
            {actionStatus}
          </div>
        )}
      </div>
    </div>
  );
};
