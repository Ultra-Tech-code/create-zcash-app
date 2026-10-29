import { NextResponse } from 'next/server';
import { dev, getDashboardWallet } from '@zcash-app/sdk';
import { NETWORK_PRESETS, Network, PresetId } from '../../endpoints';
import { getSession, getSessionIdFromRequest } from '../../session';

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

  const network: Network = preset
    ? preset.network
    : ((searchParams.get('network') || 'regtest') as Network);
  let accountId = searchParams.get('account') || 'account0';
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  // SECURITY: NEVER read ufvk from searchParams or query string.
  // UFVK is held strictly in the server-side session (httpOnly, SameSite=Strict cookie).
  let ufvk: string | undefined = undefined;

  // Check server session strictly
  const sessionId = getSessionIdFromRequest(request);
  const sessionData = sessionId ? getSession(sessionId) : undefined;
  if (sessionData && sessionData.network === network) {
    ufvk = sessionData.ufvk;
    if (sessionData.accountId) {
      accountId = sessionData.accountId;
    }
  }

  // On regtest, default to the fixture account if ufvk is not provided
  if (!ufvk && network === 'regtest') {
    try {
      const acct = dev.fixtures.account(0, 'regtest');
      ufvk = acct.getUnifiedFullViewingKey();
    } catch (_) {}
  }

  if (!ufvk) {
    return NextResponse.json({
      success: true,
      transactions: [],
      count: 0,
      network,
      accountId,
      message: 'No UFVK loaded for this account',
    });
  }

  try {
    const wallet = getDashboardWallet(network, accountId, ufvk);
    const transactions = wallet.getWalletTransactions(limit, offset);

    return NextResponse.json({
      success: true,
      transactions,
      count: transactions.length,
      network,
      accountId,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to retrieve wallet transactions',
        transactions: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
