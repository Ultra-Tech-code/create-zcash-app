'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PresetId } from '../endpoints';

interface ExplorerTabProps {
  preset: PresetId;
  network: string;
  initialQuery?: string;
  onNavigateTx?: (txid: string) => void;
}

export const ExplorerTab: React.FC<ExplorerTabProps> = ({
  preset,
  network,
  initialQuery = '',
  onNavigateTx,
}) => {
  const [searchInput, setSearchInput] = useState<string>(initialQuery);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [matchType, setMatchType] = useState<'tx' | 'block' | null>(null);
  const [matchFeedback, setMatchFeedback] = useState<string | null>(null);
  const [resultData, setResultData] = useState<any>(null);

  const zatoshisToZec = (zatoshis: number | string | bigint = 0) => {
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

  const handleSearch = useCallback(
    async (queryToSearch?: string) => {
      const q = (typeof queryToSearch === 'string' ? queryToSearch : searchInput).trim();
      if (!q) {
        setError('Please enter a transaction ID, block hash, or block height');
        setResultData(null);
        setMatchType(null);
        setMatchFeedback(null);
        return;
      }

      setLoading(true);
      setError(null);
      setResultData(null);
      setMatchType(null);
      setMatchFeedback(null);

      try {
        const res = await fetch(
          `/api/explorer?q=${encodeURIComponent(q)}&network=${encodeURIComponent(
            network
          )}&preset=${encodeURIComponent(preset)}`
        );
        const data = await res.json();

        if (data.success) {
          setMatchType(data.matchType);
          setMatchFeedback(
            data.matchType === 'tx'
              ? 'Matched: Transaction'
              : 'Matched: Block'
          );
          setResultData(data.data);
        } else {
          setError(data.error || 'Transaction or block not found');
        }
      } catch (err: any) {
        setError(err.message || 'Node unreachable: Unable to connect to indexer or node');
      } finally {
        setLoading(false);
      }
    },
    [searchInput, network, preset]
  );

  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      setSearchInput(initialQuery.trim());
      handleSearch(initialQuery.trim());
    }
  }, [initialQuery, handleSearch]);

  const onSelectBlock = (heightOrHash: string | number) => {
    const q = String(heightOrHash);
    setSearchInput(q);
    handleSearch(q);
  };

  const onSelectTx = (txid: string) => {
    if (onNavigateTx) {
      onNavigateTx(txid);
    } else {
      setSearchInput(txid);
      handleSearch(txid);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Search Header Glass Card */}
      <div className="glass-card" style={{ padding: '1.75rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🔍</span> Blockchain Explorer
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Inspect shielded NU7 transactions, Orchard/Ironwood actions, commitment trees, and block headers
          </p>
        </div>

        {/* Unified Search Input Box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          style={{ display: 'flex', gap: '0.75rem', alignItems: 'stretch' }}
        >
          <input
            id="explorer-search-input"
            data-testid="explorer-search-input"
            type="text"
            className="mono-text"
            placeholder="Search by 64-hex TxID, block hash, or block height (e.g. 4542240)..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'rgba(0, 0, 0, 0.3)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
          <button
            id="explorer-search-btn"
            data-testid="explorer-search-btn"
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ minWidth: '110px', fontSize: '0.85rem' }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* Quick Helper Chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Quick Inspect:</span>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
            onClick={() => {
              const q = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';
              setSearchInput(q);
              handleSearch(q);
            }}
          >
            Tx 8ca516ab...
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
            onClick={() => {
              const q = '4542240';
              setSearchInput(q);
              handleSearch(q);
            }}
          >
            Block 4542240
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
            onClick={() => {
              const q = '00005c49b2e52450226473f8bbc77411705f7e104835bb12909ed217f16fa92e';
              setSearchInput(q);
              handleSearch(q);
            }}
          >
            Block Hash 00005c49...
          </button>
        </div>
      </div>

      {/* Error Message Alert */}
      {error && (
        <div
          id="explorer-error"
          data-testid="explorer-error"
          className="glass-card"
          style={{
            padding: '1.25rem',
            background: 'rgba(239, 68, 68, 0.1)',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            color: '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            fontSize: '0.85rem',
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Match Type Badge */}
      {matchFeedback && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            id="explorer-match-badge"
            data-testid="explorer-match-badge"
            className="badge badge-regtest"
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            ✓ {matchFeedback}
          </span>
        </div>
      )}

      {/* --- TRANSACTION VIEW --- */}
      {matchType === 'tx' && resultData && (
        <div
          id="explorer-tx-view"
          data-testid="explorer-tx-view"
          className="glass-card"
          style={{ padding: '1.75rem' }}
        >
          {/* User Ownership Section (Shown ONLY when session UFVK trial-decrypts notes) */}
          {resultData.userOwnership && (
            <div
              id="explorer-ownership-banner"
              data-testid="explorer-ownership-banner"
              style={{
                marginBottom: '1.5rem',
                padding: '1.25rem',
                borderRadius: '8px',
                background:
                  resultData.userOwnership.direction === 'incoming'
                    ? 'rgba(16, 185, 129, 0.12)'
                    : resultData.userOwnership.direction === 'outgoing'
                    ? 'rgba(245, 158, 11, 0.12)'
                    : 'rgba(59, 130, 246, 0.12)',
                border:
                  resultData.userOwnership.direction === 'incoming'
                    ? '1px solid rgba(16, 185, 129, 0.35)'
                    : resultData.userOwnership.direction === 'outgoing'
                    ? '1px solid rgba(245, 158, 11, 0.35)'
                    : '1px solid rgba(59, 130, 246, 0.35)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span
                  id="explorer-ownership-badge"
                  data-testid="explorer-ownership-badge"
                  className="badge"
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    padding: '0.35rem 0.75rem',
                    background:
                      resultData.userOwnership.direction === 'incoming'
                        ? '#059669'
                        : resultData.userOwnership.direction === 'outgoing'
                        ? '#d97706'
                        : '#2563eb',
                    color: '#ffffff',
                  }}
                >
                  🛡️ Belongs to you ({resultData.userOwnership.direction.toUpperCase()})
                </span>
                <span
                  id="explorer-ownership-amount"
                  data-testid="explorer-ownership-amount"
                  className="mono-text"
                  style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--accent-gold)' }}
                >
                  {resultData.userOwnership.direction === 'incoming' ? '+' : '-'}
                  {resultData.userOwnership.amountZec} ZEC
                </span>
              </div>

              {resultData.userOwnership.memo && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Decrypted Memo: </span>
                  <span
                    id="explorer-ownership-memo"
                    data-testid="explorer-ownership-memo"
                    style={{ fontStyle: 'italic', color: 'var(--text-primary)' }}
                  >
                    &ldquo;{resultData.userOwnership.memo}&rdquo;
                  </span>
                </div>
              )}

              {resultData.userOwnership.counterparty && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Counterparty: </span>
                  <span className="mono-text" style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                    {resultData.userOwnership.counterparty}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Transaction Metadata Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1rem', fontWeight: 600 }}>Transaction</span>
                <span
                  id="explorer-upgrade-name"
                  data-testid="explorer-upgrade-name"
                  className="badge badge-regtest"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                >
                  {resultData.upgradeName}
                </span>
                <span className="badge" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: 'rgba(255,255,255,0.08)' }}>
                  v{resultData.version}
                </span>
              </div>
              <div
                id="explorer-txid-display"
                data-testid="explorer-txid-display"
                className="mono-text"
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--accent-gold)',
                  wordBreak: 'break-all',
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                }}
              >
                {resultData.txid}
              </div>
            </div>
          </div>

          {/* Primary Details Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
              background: 'rgba(255, 255, 255, 0.02)',
              padding: '1.25rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mined Height</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.25rem' }}>
                {resultData.height ? (
                  <button
                    type="button"
                    className="txid-link"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--accent-gold)',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      textDecoration: 'underline',
                    }}
                    onClick={() => onSelectBlock(resultData.height)}
                  >
                    #{resultData.height}
                  </button>
                ) : (
                  'Mempool / Unmined'
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Consensus Branch ID</div>
              <div
                id="explorer-branch-id"
                data-testid="explorer-branch-id"
                className="mono-text"
                style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.25rem' }}
              >
                0x{resultData.consensusBranchId} ({resultData.upgradeName})
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Expiry Height</div>
              <div
                id="explorer-expiry-height"
                data-testid="explorer-expiry-height"
                className="mono-text"
                style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.25rem' }}
              >
                #{resultData.expiryHeight}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Fee</div>
              <div
                id="explorer-fee-display"
                data-testid="explorer-fee-display"
                className="mono-text"
                style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.25rem' }}
              >
                {resultData.feeUnknown
                  ? 'unknown'
                  : `${zatoshisToZec(resultData.fee)} ZEC (${resultData.fee} zat)`}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Size</div>
              <div className="mono-text" style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.25rem' }}>
                {resultData.size} bytes
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Block Time</div>
              <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {resultData.time ? new Date(resultData.time * 1000).toLocaleString() : '—'}
              </div>
            </div>
          </div>

          {/* Block Hash Link */}
          {resultData.blockHash && (
            <div style={{ marginBottom: '1.5rem', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Block Hash: </span>
              <button
                type="button"
                className="mono-text"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--accent-gold)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  wordBreak: 'break-all',
                }}
                onClick={() => onSelectBlock(resultData.blockHash)}
              >
                {resultData.blockHash}
              </button>
            </div>
          )}

          {/* Pools Touched & Action Counts */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
              POOLS TOUCHED & ACTION BREAKDOWN
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {resultData.pools.map((p: string) => (
                <span
                  key={p}
                  className="badge badge-regtest"
                  style={{ textTransform: 'capitalize', fontSize: '0.8rem', padding: '0.25rem 0.65rem' }}
                >
                  {p}
                </span>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '0.75rem',
              }}
            >
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ironwood Actions</div>
                <div id="explorer-ironwood-actions" data-testid="explorer-ironwood-actions" style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {resultData.actionCounts.ironwoodActions}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Orchard Actions</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {resultData.actionCounts.orchardActions}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Sapling Spends / Outs</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {resultData.actionCounts.saplingSpends} / {resultData.actionCounts.saplingOutputs}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Transparent In / Out</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {resultData.actionCounts.transparentInputs} / {resultData.actionCounts.transparentOutputs}
                </div>
              </div>
            </div>
          </div>

          {/* Anchors Section */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
              SHIELDED MERKLE ANCHOR(S)
            </h3>
            {resultData.anchors.ironwood && (
              <div id="explorer-ironwood-anchor" data-testid="explorer-ironwood-anchor" style={{ marginBottom: '1rem', background: 'rgba(0, 0, 0, 0.2)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.25)' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-gold)', marginBottom: '0.35rem' }}>
                  🌳 Ironwood Anchor
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'inline-block', minWidth: '150px' }}>wallet/Orchard order: </span>
                    <span
                      id="explorer-ironwood-anchor-wallet"
                      data-testid="explorer-ironwood-anchor-wallet"
                      className="mono-text"
                      style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}
                    >
                      {typeof resultData.anchors.ironwood === 'object'
                        ? resultData.anchors.ironwood.walletOrchardOrder
                        : resultData.anchors.ironwood}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'inline-block', minWidth: '150px' }}>Zebra RPC order: </span>
                    <span
                      id="explorer-ironwood-anchor-zebra"
                      data-testid="explorer-ironwood-anchor-zebra"
                      className="mono-text"
                      style={{ color: 'var(--accent-gold)', wordBreak: 'break-all' }}
                    >
                      {typeof resultData.anchors.ironwood === 'object'
                        ? resultData.anchors.ironwood.zebraRpcOrder
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {resultData.anchors.orchard && (
              <div id="explorer-orchard-anchor" data-testid="explorer-orchard-anchor" style={{ marginBottom: '1rem', background: 'rgba(0, 0, 0, 0.2)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                  🌿 Orchard Anchor
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'inline-block', minWidth: '150px' }}>wallet/Orchard order: </span>
                    <span className="mono-text" style={{ wordBreak: 'break-all' }}>
                      {typeof resultData.anchors.orchard === 'object'
                        ? resultData.anchors.orchard.walletOrchardOrder
                        : resultData.anchors.orchard}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'inline-block', minWidth: '150px' }}>Zebra RPC order: </span>
                    <span className="mono-text" style={{ wordBreak: 'break-all' }}>
                      {typeof resultData.anchors.orchard === 'object'
                        ? resultData.anchors.orchard.zebraRpcOrder
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {resultData.anchors.sapling && (
              <div id="explorer-sapling-anchor" data-testid="explorer-sapling-anchor" style={{ marginBottom: '1rem', background: 'rgba(0, 0, 0, 0.2)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                  🌲 Sapling Anchor
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'inline-block', minWidth: '150px' }}>wallet/Orchard order: </span>
                    <span className="mono-text" style={{ wordBreak: 'break-all' }}>
                      {typeof resultData.anchors.sapling === 'object'
                        ? resultData.anchors.sapling.walletOrchardOrder
                        : resultData.anchors.sapling}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'inline-block', minWidth: '150px' }}>Zebra RPC order: </span>
                    <span className="mono-text" style={{ wordBreak: 'break-all' }}>
                      {typeof resultData.anchors.sapling === 'object'
                        ? resultData.anchors.sapling.zebraRpcOrder
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {!resultData.anchors.ironwood && !resultData.anchors.orchard && !resultData.anchors.sapling && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>None (Transparent only)</div>
            )}
          </div>

          {/* Nullifiers Section */}
          {resultData.nullifiers && resultData.nullifiers.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                SPEND NULLIFIERS ({resultData.nullifiers.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {resultData.nullifiers.map((nf: string, idx: number) => (
                  <div
                    key={nf + idx}
                    className="mono-text"
                    style={{
                      fontSize: '0.78rem',
                      background: 'rgba(0, 0, 0, 0.25)',
                      padding: '0.4rem 0.65rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      wordBreak: 'break-all',
                    }}
                  >
                    #{idx}: {nf}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Note Commitments Section */}
          {resultData.noteCommitments && resultData.noteCommitments.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                NOTE COMMITMENTS / OUTPUTS ({resultData.noteCommitments.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {resultData.noteCommitments.map((cmx: string, idx: number) => (
                  <div
                    key={cmx + idx}
                    className="mono-text"
                    style={{
                      fontSize: '0.78rem',
                      background: 'rgba(0, 0, 0, 0.25)',
                      padding: '0.4rem 0.65rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      wordBreak: 'break-all',
                    }}
                  >
                    #{idx}: {cmx}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- BLOCK VIEW --- */}
      {matchType === 'block' && resultData && (
        <div
          id="explorer-block-view"
          data-testid="explorer-block-view"
          className="glass-card"
          style={{ padding: '1.75rem' }}
        >
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1rem', fontWeight: 600 }}>Block</span>
              <span
                id="explorer-block-height-display"
                data-testid="explorer-block-height-display"
                className="badge badge-regtest"
                style={{ fontSize: '0.85rem', padding: '0.25rem 0.65rem' }}
              >
                #{resultData.height}
              </span>
            </div>
            <div
              id="explorer-block-hash-display"
              data-testid="explorer-block-hash-display"
              className="mono-text"
              style={{
                fontSize: '0.85rem',
                color: 'var(--accent-gold)',
                wordBreak: 'break-all',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
              }}
            >
              {resultData.hash}
            </div>
          </div>

          {/* Block Overview Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
              background: 'rgba(255, 255, 255, 0.02)',
              padding: '1.25rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Height</div>
              <div className="mono-text" style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {resultData.height}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Block Time</div>
              <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {resultData.time ? new Date(resultData.time * 1000).toLocaleString() : '—'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Transactions</div>
              <div
                id="explorer-tx-count"
                data-testid="explorer-tx-count"
                className="mono-text"
                style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.25rem' }}
              >
                {resultData.txCount} txs
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Previous Block</div>
              <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {resultData.previousBlockHash ? (
                  <button
                    type="button"
                    className="mono-text"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--accent-gold)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      textDecoration: 'underline',
                    }}
                    onClick={() => onSelectBlock(resultData.previousBlockHash)}
                  >
                    {resultData.previousBlockHash.slice(0, 10)}...{resultData.previousBlockHash.slice(-10)}
                  </button>
                ) : (
                  'Genesis'
                )}
              </div>
            </div>
          </div>

          {/* Commitment Tree Sizes from chainMetadata */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
              NOTE COMMITMENT TREE SIZES (chainMetadata)
            </h3>
            <div
              id="explorer-tree-sizes"
              data-testid="explorer-tree-sizes"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem',
              }}
            >
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ironwood Tree Size</div>
                <div id="explorer-ironwood-tree-size" data-testid="explorer-ironwood-tree-size" style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--accent-gold)' }}>
                  {resultData.chainMetadata?.ironwoodCommitmentTreeSize ?? 0}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Orchard Tree Size</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {resultData.chainMetadata?.orchardCommitmentTreeSize ?? 0}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Sapling Tree Size</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {resultData.chainMetadata?.saplingCommitmentTreeSize ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* Transactions in Block */}
          <div>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
              TRANSACTIONS IN THIS BLOCK ({resultData.txList.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {resultData.txList.map((tx: any, idx: number) => (
                <div
                  key={tx.txid + idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.65rem 0.85rem',
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <span className="mono-text" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    #{tx.index}
                  </span>
                  <button
                    type="button"
                    className="mono-text txid-link"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--accent-gold)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      textDecoration: 'underline',
                      wordBreak: 'break-all',
                    }}
                    onClick={() => onSelectTx(tx.txid)}
                  >
                    {tx.txid}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

