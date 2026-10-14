import { NextResponse } from 'next/server';
import { createClient, dev } from '@zcash-app/sdk';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { address, amount = '1.0', endpoint = '127.0.0.1:8137' } = body;

    if (!address) {
      return NextResponse.json({ success: false, error: 'Address is required' }, { status: 400 });
    }

    const client = createClient({ endpoint, network: 'regtest' });
    const zatoshis = BigInt(Math.round(parseFloat(amount) * 100000000));
    const result = await dev.fund(client, address, zatoshis);
    await client.close();

    return NextResponse.json({
      success: true,
      txid: result.txid,
      amount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Funding failed' },
      { status: 500 }
    );
  }
}
