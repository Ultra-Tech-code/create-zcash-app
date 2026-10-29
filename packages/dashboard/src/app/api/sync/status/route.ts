import { NextResponse } from 'next/server';
import {
  createClient,
  dev,
  getDashboardWallet,
  getDashboardSyncStatus,
  startDashboardSync,
} from '@zcash-app/sdk';
import { NETWORK_PRESETS, Network, PresetId, resolveAllowedEndpoint } from '../../../endpoints';
import {
  getSession,
  getSessionIdFromRequest,
  setSession,
  createSessionId,
  SESSION_COOKIE_NAME,
} from '../../../session';
import { verifySameOrigin } from '../../../security';

/**
 * SECURITY NOTICE:
 * Memos and counterparties are stored in plaintext in the SQLite wallet database.
 * To protect user privacy, directory permissions are strictly enforced to 0700
 * and database files to 0600 under ~/.zcash-app/dashboard/.
 */

async function handleSyncRequest(request: Request, isPost = false) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  let body: any = {};
  if (isPost) {
    try {
      body = await request.json();
    } catch (_) {}
  }

  const presetParam = (body.preset || searchParams.get('preset')) as PresetId | null;
  const preset = presetParam && NETWORK_PRESETS[presetParam] ? NETWORK_PRESETS[presetParam] : null;

  const network: Network = preset
    ? preset.network
    : ((body.network || searchParams.get('network') || 'regtest') as Network);

  const queryEndpoint = body.endpoint || searchParams.get('endpoint');
  const customEndpoint = body.customEndpoint || searchParams.get('customEndpoint');

  // Accept only NETWORK_PRESETS endpoints or an explicit custom endpoint field
  // Arbitrary 127.0.0.1:* from the query string is rejected
  const endpoint = resolveAllowedEndpoint({
    presetParam,
    network,
    queryEndpoint,
    customEndpoint,
  });

  let accountId = body.account || searchParams.get('account') || 'account0';
  const rawBirthday = body.birthday !== undefined ? body.birthday : searchParams.get('birthday');
  let birthday = rawBirthday !== undefined && rawBirthday !== null ? parseInt(String(rawBirthday), 10) : undefined;
  const shouldStart = body.start !== undefined ? body.start !== false : searchParams.get('start') !== 'false';
  const targetHeight =
    body.targetHeight !== undefined
      ? parseInt(String(body.targetHeight), 10)
      : searchParams.get('targetHeight')
      ? parseInt(searchParams.get('targetHeight')!, 10)
      : undefined;
  const batchSize =
    body.batchSize !== undefined
      ? parseInt(String(body.batchSize), 10)
      : searchParams.get('batchSize')
      ? parseInt(searchParams.get('batchSize')!, 10)
      : 50;

  // SECURITY: NEVER read ufvk from the query string or GET requests.
  // UFVK is accepted ONLY in a POST body, then held in the server-side session.
  let ufvk: string | undefined = isPost && body.ufvk ? String(body.ufvk).trim() : undefined;

  // Check server session if ufvk not provided directly in POST body
  const sessionId = getSessionIdFromRequest(request);
  let sessionData = sessionId ? getSession(sessionId) : undefined;
  if (!ufvk && sessionData && sessionData.network === network) {
    ufvk = sessionData.ufvk;
    if (birthday === undefined) {
      birthday = sessionData.birthday;
    }
    if (sessionData.accountId) {
      accountId = sessionData.accountId;
    }
  }

  // If POST provided ufvk & birthday, store in session
  let newSessionId: string | null = null;
  if (isPost && ufvk && birthday !== undefined) {
    newSessionId = sessionId || createSessionId();
    setSession(newSessionId, {
      ufvk,
      birthday,
      network,
      accountId,
    });
  }

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
    const effectiveAccountId =
      presetParam === 'regtest-z3' && accountId === 'account0'
        ? 'account0_z3'
        : accountId;
    const wallet = getDashboardWallet(network, effectiveAccountId, ufvk, birthday);

    if (shouldStart) {
      const client = createClient({ endpoint, network });
      startDashboardSync(client, wallet, {
        network,
        accountId: effectiveAccountId,
        birthday,
        ufvk,
        targetHeight,
        batchSize,
      });
    }

    const syncStatus = getDashboardSyncStatus(network, effectiveAccountId, wallet);

    const response = NextResponse.json({
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

    if (newSessionId && !sessionId) {
      response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: newSessionId,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: false,
      });
    }

    return response;
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

export async function GET(request: Request) {
  return handleSyncRequest(request, false);
}

export async function POST(request: Request) {
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  return handleSyncRequest(request, true);
}
