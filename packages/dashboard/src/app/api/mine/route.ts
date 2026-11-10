import { NextResponse } from 'next/server';
import { verifySameOrigin } from '../../security';

export async function POST(request: Request) {
  const originError = verifySameOrigin(request);
  if (originError) return originError;

  try {
    const body = await request.json();
    const { blocks = 1, endpoint = '127.0.0.1:39067', preset = 'regtest-lightwalletd' } = body;

    // Direct Zebra JSON-RPC target (all regtest tiers use port 39232)
    const rpcUrl = process.env.ZCASH_ZEBRA_RPC || 'http://127.0.0.1:39232';

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dashboard-mine',
        method: 'generate',
        params: [Number(blocks)],
      }),
    });

    if (!res.ok) {
      throw new Error(`Zebra mining HTTP error: ${res.statusText}`);
    }

    const data: any = await res.json();
    if (data.error) {
      throw new Error(`Zebra mining JSON-RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    return NextResponse.json({
      success: true,
      blocks,
      rpcUrl,
      result: data.result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Mining failed' },
      { status: 500 }
    );
  }
}
