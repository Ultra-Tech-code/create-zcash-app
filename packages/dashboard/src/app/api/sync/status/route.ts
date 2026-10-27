import { NextResponse } from 'next/server';
import {
  createClient,
  dev,
  getDashboardWallet,
  getDashboardSyncStatus,
  startDashboardSync,
} from '@zcash-app/sdk';
import { NETWORK_PRESETS, Network, PresetId, ALLOWED_ENDPOINTS } from '../../../endpoints';

/**
 * SECURITY NOTICE:
 * Memos and counterparties are stored in plaintext in the SQLite wallet database.
 * To protect user privacy, directory permissions are strictly enforced to 0700
 * and database files to 0600 under ~/.zcash-app/dashboard/.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const presetParam = searchParams.get('preset') as PresetId | null;
  const preset = presetParam && NETWORK_PRESETS[presetParam] ? NETWORK_PRESETS[presetParam] : null;

  const network: Network = preset ? preset.network : ((searchParams.get('network') || 'regtest') as Network);
  const queryEndpoint = searchParams.get('endpoint');

  let endpoint = preset ? preset.endpoint : (queryEndpoint || '127.0.0.1:28137');
  if (queryEndpoint) {
    const isAllowed =
      queryEndpoint.startsWith('127.0.0.1:') ||
      queryEndpoint.startsWith('localhost:') ||
      ALLOWED_ENDPOINTS.includes(queryEndpoint);
    if (isAllowed) {
      endpoint = queryEndpoint;
    }
  }

  const accountId = searchParams.get('account') || 'account0';
  const rawBirthday = searchParams.get('birthday');
  const birthday = rawBirthday ? parseInt(rawBirthday, 10) : undefined;
  const shouldStart = searchParams.get('start') !== 'false';

  let ufvk = searchParams.get('ufvk') || undefined;

  // On regtest, default to the fixture account if ufvk is not provided
  if (!ufvk && network === 'regtest') {
    try {
      const acct = dev.fixtures.account(0, 'regtest');
      ufvk = acct.getUnifiedFullViewingKey();
    } catch (_) {}
  }

  if (!ufvk) {
    const status = getDashboardSyncStatus(network, accountId);
    return NextResponse.json({
      success: true,
      status: status.status,
      scanned: status.scanned,
      target: status.target,
      notesFound: status.notesFound,
      pendingFetches: status.pendingFetches,
      failedFetches: status.failedFetches,
      error: status.error,
      message: 'UFVK required for background synchronization',
    });
  }

  try {
    const wallet = getDashboardWallet(network, accountId, ufvk, birthday);

    if (shouldStart) {
      const client = createClient({ endpoint, network });
      startDashboardSync(client, wallet, {
        network,
        birthday,
        ufvk,
      });
    }

    const syncStatus = getDashboardSyncStatus(network, accountId, wallet);

    return NextResponse.json({
      success: true,
      status: syncStatus.status,
      scanned: syncStatus.scanned,
      target: syncStatus.target,
      notesFound: syncStatus.notesFound,
      pendingFetches: syncStatus.pendingFetches,
      failedFetches: syncStatus.failedFetches,
      error: syncStatus.error,
      lastSyncedAt: syncStatus.lastSyncedAt,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        status: 'error',
        scanned: 0,
        target: 0,
        notesFound: 0,
        pendingFetches: 0,
        failedFetches: 0,
        error: err.message || 'Failed to initialize wallet handle',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  // Support POST as well for body-based configuration
  return GET(request);
}
