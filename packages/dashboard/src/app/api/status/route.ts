import { NextResponse } from 'next/server';
import { createClient } from '@zcash-app/sdk';
import { NETWORK_ENDPOINTS, Network } from '../../endpoints';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const network = (searchParams.get('network') || 'regtest') as Network;
  const defaultEndpoint = NETWORK_ENDPOINTS[network] || '127.0.0.1:8137';
  const queryEndpoint = searchParams.get('endpoint');
  const endpoint = (queryEndpoint && (queryEndpoint.startsWith('127.0.0.1:') || queryEndpoint.startsWith('localhost:') || Object.values(NETWORK_ENDPOINTS).includes(queryEndpoint)))
    ? queryEndpoint
    : defaultEndpoint;

  try {
    const client = createClient({ endpoint, network });
    const info = await client.getInfo();
    await client.close();

    return NextResponse.json({
      success: true,
      network,
      endpoint,
      info,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        network,
        endpoint,
        error: err.message || 'Failed to connect to indexer',
      },
      { status: 500 }
    );
  }
}
