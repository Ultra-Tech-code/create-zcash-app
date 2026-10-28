import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import {
  createSessionId,
  getSessionIdFromRequest,
  setSession,
  validateUfvkPrefix,
  SESSION_COOKIE_NAME,
} from '../../../session';

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Importing UFVK is POST only' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ufvk, birthday, network = 'testnet', accountId = 'account0' } = body;

    if (!ufvk || typeof ufvk !== 'string' || !ufvk.trim()) {
      return NextResponse.json(
        { success: false, error: 'UFVK is required' },
        { status: 400 }
      );
    }

    if (birthday === undefined || birthday === null || typeof birthday !== 'number' || isNaN(birthday) || birthday < 0) {
      return NextResponse.json(
        { success: false, error: 'Birthday height is required on import and must be a non-negative integer' },
        { status: 400 }
      );
    }

    const validation = validateUfvkPrefix(ufvk, network);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const sessionId = getSessionIdFromRequest(request) || createSessionId();
    const ufvkHash = crypto.createHash('sha256').update(ufvk.trim()).digest('hex').slice(0, 8);
    const effectiveAccountId = accountId && accountId !== 'account0' ? accountId : `acct_${ufvkHash}`;

    setSession(sessionId, {
      ufvk: ufvk.trim(),
      birthday: Math.floor(birthday),
      network,
      accountId: effectiveAccountId,
    });

    const response = NextResponse.json({
      success: true,
      message: 'UFVK imported successfully in server memory',
      network,
      birthday: Math.floor(birthday),
      accountId: effectiveAccountId,
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionId,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: false,
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to import UFVK' },
      { status: 500 }
    );
  }
}
