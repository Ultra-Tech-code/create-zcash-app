'use client';

import React from 'react';
import { PresetId } from '../endpoints';

interface SendTabProps {
  preset: PresetId;
  network: string;
  sendToAddress: string;
  setSendToAddress: (addr: string) => void;
  sendAmount: string;
  setSendAmount: (amt: string) => void;
  sendMemo: string;
  setSendMemo: (memo: string) => void;
  sendSubmitting: boolean;
  sendReceipt: any;
  actionStatus: string;
  onSend: (e: React.FormEvent) => void;
}

export const SendTab: React.FC<SendTabProps> = ({
  preset,
  network,
  sendToAddress,
  setSendToAddress,
  sendAmount,
  setSendAmount,
  sendMemo,
  setSendMemo,
  sendSubmitting,
  sendReceipt,
  actionStatus,
  onSend,
}) => {
  const isZ3Regtest = preset === 'regtest-z3';
  const isNu7Regtest = preset === 'regtest-nu7';
  const isWatchOnly = network !== 'regtest';

  if (isWatchOnly) {
    return (
      <div className="glass-card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Send Shielded Transaction</h2>
        <div style={{ padding: '1.25rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '8px', color: '#93c5fd', fontSize: '0.85rem', lineHeight: '1.5' }}>
          🔒 <strong>Watch-Only Mode:</strong> On {network}, the dashboard operates strictly in read-only / watch-only mode using Unified Full Viewing Keys (UFVK). Private spending keys and mnemonics are never held by or exposed in this interface.
        </div>
      </div>
    );
  }

  if (isNu7Regtest) {
    return (
      <div className="glass-card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Send Transaction</h2>
        <div style={{ padding: '1.25rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '8px', color: '#fde047', fontSize: '0.85rem', lineHeight: '1.5' }}>
          ℹ️ <strong>Zallet Funding Proxy Unavailable on NU7 Regtest:</strong>
          <br />
          The standalone NU7 regtest stack productizes Zebra 7.0.0 + Lightwalletd without a Zallet instance. To generate funds on this stack, use the Faucet tab to mine blocks directly to Account 0.
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ maxWidth: '640px' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Fund from Zallet (Regtest Proxy)</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Sends ZEC from the local Zallet regtest wallet using <code>z_sendmany</code> via the RPC router.
      </p>

      <form onSubmit={onSend} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
            Recipient Unified or Transparent Address:
          </label>
          <input
            id="send-recipient-input"
            type="text"
            value={sendToAddress}
            onChange={(e) => setSendToAddress(e.target.value)}
            placeholder="uregtest1... or tm..."
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
            Amount (ZEC):
          </label>
          <input
            id="send-amount-input"
            type="text"
            value={sendAmount}
            onChange={(e) => setSendAmount(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
            Memo (Optional):
          </label>
          <input
            id="send-memo-input"
            type="text"
            value={sendMemo}
            onChange={(e) => setSendMemo(e.target.value)}
            placeholder="Encrypted shielded memo"
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
        </div>

        <button
          id="send-submit-btn"
          type="submit"
          className="btn-primary"
          disabled={sendSubmitting || !sendToAddress}
          style={{ opacity: sendSubmitting || !sendToAddress ? 0.6 : 1 }}
        >
          {sendSubmitting ? 'Submitting Transaction...' : 'Send Transaction'}
        </button>
      </form>

      {actionStatus && (
        <div style={{ marginTop: '1.25rem', padding: '0.75rem', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--accent-gold)' }}>
          {actionStatus}
        </div>
      )}

      {sendReceipt && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-green)', marginBottom: '0.5rem' }}>
            ✓ Transaction Confirmed
          </h3>
          <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div>
              TxID:{' '}
              <a
                href={`/explorer/${sendReceipt.txid}?preset=${encodeURIComponent(preset)}&network=${encodeURIComponent(network)}`}
                className="mono-text"
                style={{
                  color: 'var(--accent-gold)',
                  textDecoration: 'none',
                  borderBottom: '1px dotted var(--accent-gold)',
                }}
                title="Inspect in Explorer"
              >
                {sendReceipt.txid}
              </a>
            </div>
            <div>Amount: <strong>{sendReceipt.amount} ZEC</strong></div>
            <div>Fee: <span className="mono-text">{sendReceipt.fee} zatoshis</span></div>
          </div>
        </div>
      )}
    </div>
  );
};
