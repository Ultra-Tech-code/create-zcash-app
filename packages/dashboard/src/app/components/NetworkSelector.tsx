'use client';

import React from 'react';
import { NETWORK_PRESETS, PresetId } from '../endpoints';

interface NetworkSelectorProps {
  activePreset: PresetId;
  onSelectPreset: (preset: PresetId) => void;
  isConnected: boolean;
  endpoint: string;
}

export const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  activePreset,
  onSelectPreset,
  isConnected,
  endpoint,
}) => {
  const current = NETWORK_PRESETS[activePreset] || NETWORK_PRESETS['regtest-nu7'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'rgba(255, 255, 255, 0.05)',
            padding: '0.4rem 0.75rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isConnected ? 'var(--accent-green)' : 'var(--accent-red)',
              boxShadow: isConnected ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-red)',
            }}
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {isConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <select
          id="network-preset-select"
          value={activePreset}
          onChange={(e) => onSelectPreset(e.target.value as PresetId)}
          style={{
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            padding: '0.45rem 0.85rem',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {Object.values(NETWORK_PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem' }}>
        <span>Target: <code className="mono-text">{endpoint}</code></span>
        {current.isLocal && <span style={{ color: 'var(--accent-gold)' }}>• Local</span>}
      </div>
    </div>
  );
};
