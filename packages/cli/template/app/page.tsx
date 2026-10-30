'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

type AccountBalance = {
  total: string;
  ironwood: string;
  orchard: string;
  sapling: string;
  transparent: string;
};

type AccountResponse = {
  success: boolean;
  error?: string;
  network: string;
  endpoint: string;
  address: string;
  birthday: number | null;
  generatedMnemonic: boolean;
  balance: AccountBalance | null;
  balanceError: string | null;
  message: string;
};

function formatZec(zatoshis: string): string {
  try {
    const value = BigInt(zatoshis);
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const whole = absolute / 100000000n;
    const fraction = (absolute % 100000000n).toString().padStart(8, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  } catch {
    return zatoshis;
  }
}

const card: CSSProperties = {
  border: '1px solid #27272a',
  borderRadius: 12,
  padding: '1rem 1.25rem',
  background: '#131318',
};

const label: CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#a1a1aa',
};

const mono: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 13,
  wordBreak: 'break-all',
};

export default function HomePage() {
  const [data, setData] = useState<AccountResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      const json = (await response.json()) as AccountResponse;
      if (!response.ok || !json.success) {
        throw new Error(json.error ?? `Request failed with status ${response.status}`);
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.9rem', margin: 0 }}>__PROJECT_NAME__</h1>
      <p style={{ color: '#a1a1aa', marginTop: '0.5rem' }}>
        Shielded Zcash app scaffolded by create-zcash-app, powered by @zcash-app/sdk.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', margin: '1.5rem 0' }}>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '0.55rem 1rem',
            borderRadius: 8,
            border: '1px solid #3f3f46',
            background: loading ? '#27272a' : '#f4f4f5',
            color: loading ? '#a1a1aa' : '#0b0b0f',
            fontWeight: 600,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {data && (
          <span style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>
            {data.network} · {data.endpoint}
          </span>
        )}
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#7f1d1d', color: '#fca5a5' }} role="alert">
          {error}
        </div>
      )}

      {data && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <section style={card}>
            <div style={label}>Unified address</div>
            <div style={{ ...mono, marginTop: '0.5rem' }} data-testid="account-address">
              {data.address}
            </div>
          </section>

          <section style={card}>
            <div style={label}>Balance</div>
            {data.balance ? (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ fontSize: '1.6rem', fontWeight: 600 }} data-testid="account-balance">
                  {formatZec(data.balance.total)} ZEC
                </div>
                <div style={{ ...mono, color: '#a1a1aa', marginTop: '0.5rem' }}>
                  ironwood {formatZec(data.balance.ironwood)} · orchard {formatZec(data.balance.orchard)}{' '}
                  · sapling {formatZec(data.balance.sapling)} · transparent{' '}
                  {formatZec(data.balance.transparent)}
                </div>
              </div>
            ) : (
              <p style={{ color: '#fca5a5', marginTop: '0.5rem' }}>
                {data.balanceError ?? 'No balance available'}
              </p>
            )}
          </section>

          {data.generatedMnemonic && (
            <p style={{ ...card, color: '#fcd34d', margin: 0 }}>
              No ZCASH_MNEMONIC is set, so this address comes from a mnemonic generated in memory
              for this server process. Set ZCASH_MNEMONIC in .env.local to keep an address across
              restarts, and fund it with <code>pnpm fund</code> on regtest.
            </p>
          )}

          <p style={{ color: '#71717a', margin: 0 }}>{data.message}</p>
          {data.birthday === null && (
            <p style={{ color: '#71717a', margin: 0 }}>
              No ZCASH_BIRTHDAY set, so the balance scan starts at the pool activation height.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
