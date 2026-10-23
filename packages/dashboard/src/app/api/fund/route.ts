import { NextResponse } from 'next/server';
import { createClient, dev } from '@zcash-app/sdk';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { address, amount = '1.0', endpoint = '127.0.0.1:28137' } = body;

    if (!address) {
      return NextResponse.json({ success: false, error: 'Address is required' }, { status: 400 });
    }

    const client = createClient({ endpoint, network: 'regtest' });
    const amountStr = String(amount).trim();
    const [wholeStr, fracStr = ''] = amountStr.split('.');
    const paddedFrac = fracStr.padEnd(8, '0').slice(0, 8);
    const zatoshis = BigInt(wholeStr) * BigInt(100000000) + BigInt(paddedFrac);
    const result = await dev.fund(client, address, zatoshis);
    await client.close();

    return NextResponse.json({
      success: true,
      txid: result.txid,
      fee: result.fee ? result.fee.toString() : '10000',
      amount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Funding failed' },
      { status: 500 }
    );
  }
}
