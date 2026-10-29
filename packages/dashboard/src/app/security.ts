/**
 * Security utilities for the dashboard API routes.
 */

/**
 * Verifies that a state-changing POST request originates from the same origin.
 * Rejects cross-site requests with HTTP 403 Forbidden.
 *
 * Checks:
 * 1. Sec-Fetch-Site header (rejects 'cross-site')
 * 2. Origin header (ensures origin matches the host or request origin)
 */
export function verifySameOrigin(request: Request): Response | null {
  // 1. Check Sec-Fetch-Site metadata header (sent by modern browsers)
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
    return Response.json(
      {
        success: false,
        error: 'Forbidden: Cross-site request rejected',
        code: 'CROSS_SITE_FORBIDDEN',
      },
      { status: 403 }
    );
  }

  // 2. Check Origin header against Host or request URL
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
      if (host) {
        if (originUrl.host !== host) {
          return Response.json(
            {
              success: false,
              error: 'Forbidden: Cross-origin request rejected',
              code: 'CROSS_ORIGIN_FORBIDDEN',
            },
            { status: 403 }
          );
        }
      } else {
        const reqUrl = new URL(request.url);
        if (originUrl.origin !== reqUrl.origin) {
          return Response.json(
            {
              success: false,
              error: 'Forbidden: Cross-origin request rejected',
              code: 'CROSS_ORIGIN_FORBIDDEN',
            },
            { status: 403 }
          );
        }
      }
    } catch {
      return Response.json(
        {
          success: false,
          error: 'Forbidden: Malformed Origin header',
          code: 'INVALID_ORIGIN',
        },
        { status: 403 }
      );
    }
  }

  return null;
}

