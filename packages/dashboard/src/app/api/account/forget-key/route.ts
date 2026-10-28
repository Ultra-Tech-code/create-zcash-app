import { NextResponse } from 'next/server';
import {
  getSessionIdFromRequest,
  deleteSession,
  SESSION_COOKIE_NAME,
} from '../../../session';

export async function POST(request: Request) {
  const sessionId = getSessionIdFromRequest(request);
  if (sessionId) {
    deleteSession(sessionId);
  }

  const response = NextResponse.json({
    success: true,
    message: 'UFVK forgotten and session cleared',
  });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}
