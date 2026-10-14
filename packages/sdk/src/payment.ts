export function buildPaymentRequest(req: {
  to: string;
  value: bigint;
  memo?: string;
  label?: string;
}): string {
  const url = new URL(`zcash:${req.to}`);
  // 1 ZEC = 100,000,000 zatoshis
  const zecWhole = Number(req.value) / 100000000;
  url.searchParams.set('amount', zecWhole.toFixed(8));

  if (req.memo) {
    // ZIP-321 base64url memo encoding
    const memoBase64 = Buffer.from(req.memo, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    url.searchParams.set('memo', memoBase64);
  }

  if (req.label) {
    url.searchParams.set('label', req.label);
  }

  return url.toString();
}

export function parsePaymentRequest(uri: string): {
  to: string;
  value?: bigint;
  memo?: string;
  label?: string;
} {
  const url = new URL(uri);
  const to = url.pathname;
  const amountStr = url.searchParams.get('amount');
  let value: bigint | undefined;

  if (amountStr) {
    const parsed = parseFloat(amountStr);
    value = BigInt(Math.round(parsed * 100000000));
  }

  let memo: string | undefined;
  const memoParam = url.searchParams.get('memo');
  if (memoParam) {
    const unpadded = memoParam.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (unpadded.length % 4)) % 4;
    const base64 = unpadded + '='.repeat(padLen);
    memo = Buffer.from(base64, 'base64').toString('utf8');
  }

  const label = url.searchParams.get('label') ?? undefined;

  return {
    to,
    value,
    memo,
    label,
  };
}
