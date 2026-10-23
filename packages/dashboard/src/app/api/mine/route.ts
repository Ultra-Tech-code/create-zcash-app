import { NextResponse } from 'next/server';
import { createClient, dev } from '@zcash-app/sdk';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { blocks = 1, endpoint = '127.0.0.1:28137' } = body;

    const client = createClient({ endpoint, network: 'regtest' });
    await dev.mine(client, Number(blocks));
    await client.close();

    return NextResponse.json({
      success: true,
      blocks,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Mining failed' },
      { status: 500 }
    );
  }
}
