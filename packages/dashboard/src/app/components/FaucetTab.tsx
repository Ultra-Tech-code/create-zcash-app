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
  const isNu7Regtest = preset === 'regtest-nu7';
  const isZ3Regtest = preset === 'regtest-z3';
  const isWatchOnly = network !== 'regtest';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Block Mining Card */}
      <div className="glass-card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Regtest Block Generation</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          {isNu7Regtest
            ? 'Calls Zebra generate RPC on 127.0.0.1:39232 directly. Mining coinbase rewards are paid to Account 0.'
            : isZ3Regtest
            ? 'Calls Zebra generate RPC via router on 127.0.0.1:8181. Mining coinbase rewards are paid to the configured miner address.'
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

        {isNu7Regtest ? (
          <div
            id="zallet-disabled-banner"
            style={{
              padding: '1rem 1.25rem',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
              color: '#fde047',
              fontSize: '0.85rem',
              lineHeight: '1.5',
            }}
          >
            ℹ️ <strong>Fund from Zallet is unavailable on the standalone NU7 regtest preset:</strong>
            <br />
            This preset runs pure Zebra 7.0.0 + Lightwalletd without a Zallet instance. To fund this environment, use <strong>"Mine 1 Block"</strong> above—Zebra automatically credits coinbase mining rewards directly to Account 0 (<code className="mono-text">{accountData?.unifiedAddress?.slice(0, 16)}...</code>).
          </div>
        ) : isZ3Regtest ? (
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
