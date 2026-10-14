import { NextResponse } from 'next/server';
import { createClient } from '@zcash-app/sdk';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const network = (searchParams.get('network') || 'regtest') as any;
  const endpoint = searchParams.get('endpoint') || '127.0.0.1:8137';

  try {
    const client = createClient({ endpoint, network });
    const info = await client.getInfo();
    await client.close();

    return NextResponse.json({
      success: true,
      info,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to connect to indexer',
      },
      { status: 500 }
    );
  }
}
