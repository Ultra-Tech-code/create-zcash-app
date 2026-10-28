'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { NETWORK_PRESETS, PresetId } from './endpoints';
import { NetworkSelector } from './components/NetworkSelector';
import { ConsensusBanner } from './components/ConsensusBanner';
import { OverviewTab } from './components/OverviewTab';
import { AddressesTab } from './components/AddressesTab';
import { TransactionsTab } from './components/TransactionsTab';
import { FaucetTab } from './components/FaucetTab';
import { SendTab } from './components/SendTab';
import { HealthTab } from './components/HealthTab';

export default function Dashboard() {
  const [activePreset, setActivePreset] = useState<PresetId>('regtest-nu7');
  const [activeTab, setActiveTab] = useState<'overview' | 'addresses' | 'transactions' | 'faucet' | 'send' | 'health'>('overview');
  const [activeAccountIndex, setActiveAccountIndex] = useState<number>(0);
  const [nodeInfo, setNodeInfo] = useState<any>(null);
  const [accountData, setAccountData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState<string>('');

  // Send state
  const [sendToAddress, setSendToAddress] = useState<string>('');
  const [sendAmount, setSendAmount] = useState<string>('0.1');
  const [sendMemo, setSendMemo] = useState<string>('');
  const [sendSubmitting, setSendSubmitting] = useState<boolean>(false);
  const [sendReceipt, setSendReceipt] = useState<any>(null);

  const currentPreset = NETWORK_PRESETS[activePreset] || NETWORK_PRESETS['regtest-nu7'];
  const network = currentPreset.network;
  const endpoint = currentPreset.endpoint;

  const refreshData = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, acctRes] = await Promise.all([
        fetch(`/api/status?preset=${activePreset}`),
        fetch(`/api/account?preset=${activePreset}&index=${activeAccountIndex}`),
      ]);

      const statusJson = await statusRes.json();
      const acctJson = await acctRes.json();

      if (statusJson.success) {
        setNodeInfo(statusJson.info);
      } else {
        setNodeInfo(null);
      }

      if (acctJson) {
        setAccountData(acctJson);
      } else {
        setAccountData(null);
      }
    } catch (e: any) {
      console.error('Error fetching dashboard data:', e);
    } finally {
      setLoading(false);
    }
  }, [activePreset, activeAccountIndex]);

  // Load initial preset from URL or config if present
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const queryPreset = searchParams.get('preset') as PresetId | null;
      if (queryPreset && NETWORK_PRESETS[queryPreset]) {
        setActivePreset(queryPreset);
        return;
      }
    }

    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.config?.preset && NETWORK_PRESETS[data.config.preset as PresetId]) {
          setActivePreset(data.config.preset as PresetId);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 10000);
    return () => clearInterval(interval);
  }, [refreshData]);

  const handleMine = async (blocks = 1) => {
    if (network !== 'regtest') return;
    try {
      setActionStatus(`Mining ${blocks} block(s)...`);
      const res = await fetch('/api/mine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks, preset: activePreset, endpoint }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus(`Mined ${blocks} block(s) successfully!`);
        refreshData();
      } else {
        setActionStatus(`Mining error: ${data.error}`);
      }
    } catch (e: any) {
      setActionStatus(`Mining failed: ${e.message}`);
    }
  };

  const handleFund = async () => {
    if (network !== 'regtest') return;
    if (activePreset === 'regtest-nu7') {
      setActionStatus('Zallet funding proxy unavailable on standalone NU7 regtest. Use Mine 1 Block.');
      return;
    }
    if (!accountData?.unifiedAddress) return;

    try {
      setActionStatus('Funding account with 1.0 ZEC from Zallet...');
      const res = await fetch('/api/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: accountData.unifiedAddress, amount: '1.0' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus(`Funded successfully! Txid: ${data.txid?.slice(0, 16)}...`);
        refreshData();
      } else {
        setActionStatus(`Funding error: ${data.error}`);
      }
    } catch (e: any) {
      setActionStatus(`Funding failed: ${e.message}`);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendToAddress) {
      setActionStatus('Please enter a recipient address');
      return;
    }
    setSendSubmitting(true);
    setActionStatus(`Sending ${sendAmount} ZEC to ${sendToAddress.slice(0, 16)}...`);
    try {
      const res = await fetch('/api/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: sendToAddress, amount: sendAmount }),
      });
      const data = await res.json();
      if (data.success) {
        setSendReceipt({
          txid: data.txid,
          amount: data.amount,
          fee: data.fee,
          to: sendToAddress,
        });
        setActionStatus(`Transaction confirmed! Txid: ${data.txid?.slice(0, 16)}...`);
        refreshData();
      } else {
        setActionStatus(`Send error: ${data.error}`);
      }
    } catch (e: any) {
      setActionStatus(`Send failed: ${e.message}`);
    } finally {
      setSendSubmitting(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Top Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ color: 'var(--accent-gold)' }}>🛡️</span> Zcash Dev Dashboard
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Multi-network inspection, consensus verification, and shielded note analytics
          </p>
        </div>

        <NetworkSelector
          activePreset={activePreset}
          onSelectPreset={(p) => setActivePreset(p)}
          isConnected={Boolean(nodeInfo)}
          endpoint={endpoint}
        />
      </header>

      {/* Consensus Verification Banner */}
      <ConsensusBanner nodeInfo={nodeInfo} network={network} />

      {/* Navigation Tabs */}
      <nav style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', paddingBottom: '0.5rem', overflowX: 'auto' }}>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'addresses', aliasId: 'keys', label: 'Keys' },
          { id: 'transactions', aliasId: 'activity', label: 'Activity' },
          { id: 'faucet', label: 'Faucet / Mine' },
          { id: 'send', label: 'Send' },
          { id: 'health', label: 'Health' },
        ].map(({ id, aliasId, label }) => (
          <React.Fragment key={id}>
            <button
              id={`tab-${id}`}
              data-testid={`tab-${id}`}
              className={activeTab === id ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}
              onClick={() => setActiveTab(id as any)}
            >
              {label}
            </button>
            {aliasId && (
              <button
                id={`tab-${aliasId}`}
                data-testid={`tab-${aliasId}`}
                style={{ display: 'none' }}
                onClick={() => setActiveTab(id as any)}
              />
            )}
          </React.Fragment>
        ))}
      </nav>

      {/* Tab Panels */}
      <main>
        {activeTab === 'overview' && (
          <OverviewTab
            accountData={accountData}
            nodeInfo={nodeInfo}
            preset={activePreset}
            network={network}
            onMine={handleMine}
            onFund={handleFund}
            actionStatus={actionStatus}
          />
        )}

        {activeTab === 'addresses' && (
          <AddressesTab
            accountData={accountData}
            activeAccountIndex={activeAccountIndex}
            onSelectAccountIndex={(idx) => setActiveAccountIndex(idx)}
            network={network}
            onRefresh={refreshData}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionsTab
            notes={accountData?.notes || []}
            network={network}
            preset={activePreset}
            account="account0"
          />
        )}

        {activeTab === 'faucet' && (
          <FaucetTab
            preset={activePreset}
            network={network}
            accountData={accountData}
            onMine={handleMine}
            onFund={handleFund}
            actionStatus={actionStatus}
          />
        )}

        {activeTab === 'send' && (
          <SendTab
            preset={activePreset}
            network={network}
            sendToAddress={sendToAddress}
            setSendToAddress={setSendToAddress}
            sendAmount={sendAmount}
            setSendAmount={setSendAmount}
            sendMemo={sendMemo}
            setSendMemo={setSendMemo}
            sendSubmitting={sendSubmitting}
            sendReceipt={sendReceipt}
            actionStatus={actionStatus}
            onSend={handleSend}
          />
        )}

        {activeTab === 'health' && (
          <HealthTab
            preset={activePreset}
            nodeInfo={nodeInfo}
            isConnected={Boolean(nodeInfo)}
            endpoint={endpoint}
          />
        )}
      </main>
    </div>
  );
}
