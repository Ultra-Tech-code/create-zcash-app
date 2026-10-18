import { NextResponse } from 'next/server';
import { createClient, dev, getBalance, detectIncoming } from '@zcash-app/sdk';
import { NETWORK_ENDPOINTS, Network } from '../../endpoints';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const network = (searchParams.get('network') || 'regtest') as Network;
  const defaultEndpoint = NETWORK_ENDPOINTS[network] || '127.0.0.1:8137';
  const queryEndpoint = searchParams.get('endpoint');
  // Security guard: only allow known endpoints or localhost in development
  const endpoint = (queryEndpoint && (queryEndpoint.startsWith('127.0.0.1:') || queryEndpoint.startsWith('localhost:') || Object.values(NETWORK_ENDPOINTS).includes(queryEndpoint)))
    ? queryEndpoint
    : defaultEndpoint;
  const fixtureIndex = parseInt(searchParams.get('index') || '0', 10);

  try {
    const acct = dev.fixtures.account(fixtureIndex, network as any);
    const ua = acct.getUnifiedAddress();
    const ufvk = acct.getUnifiedFullViewingKey();

    let balances = {
      orchard: '0',
      ironwood: '0',
      sapling: '0',
      transparent: '0',
      total: '0',
    };
    let incomingNotes: any[] = [];

    // Attempt balance and note scanning
    try {
      const client = createClient({ endpoint, network });
      const rawBalances = await getBalance(client, acct);
      balances = {
        orchard: rawBalances.orchard.toString(),
        ironwood: rawBalances.ironwood.toString(),
        sapling: rawBalances.sapling.toString(),
        transparent: rawBalances.transparent.toString(),
        total: rawBalances.total.toString(),
      };
      const { notes } = await detectIncoming(client, acct);
      incomingNotes = notes.map((n) => ({
        ...n,
        value: n.value.toString(),
      }));
      await client.close();
    } catch (e: any) {
      // Remote or local indexer may be unreachable or scanning
    }

    const transparentAddress = acct.getTransparentAddress ? acct.getTransparentAddress() : undefined;

    return NextResponse.json({
      success: true,
      accountIndex: fixtureIndex,
      network,
      endpoint,
      unifiedAddress: ua,
      transparentAddress,
      ufvk,
      balances,
      notes: incomingNotes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Account derivation failed' },
      { status: 500 }
    );
  }
}
