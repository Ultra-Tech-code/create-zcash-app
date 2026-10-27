import { NextResponse } from 'next/server';
import { createClient, dev, getBalance, detectIncoming } from '@zcash-app/sdk';
import { NETWORK_PRESETS, Network, PresetId, ALLOWED_ENDPOINTS } from '../../endpoints';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const presetParam = searchParams.get('preset') as PresetId | null;
  const preset = presetParam && NETWORK_PRESETS[presetParam] ? NETWORK_PRESETS[presetParam] : null;

  const network: Network = preset ? preset.network : ((searchParams.get('network') || 'regtest') as Network);
  const queryEndpoint = searchParams.get('endpoint');

  let endpoint = preset ? preset.endpoint : (queryEndpoint || '127.0.0.1:28137');
  if (queryEndpoint) {
    const isAllowed =
      queryEndpoint.startsWith('127.0.0.1:') ||
      queryEndpoint.startsWith('localhost:') ||
      ALLOWED_ENDPOINTS.includes(queryEndpoint);
    if (isAllowed) {
      endpoint = queryEndpoint;
    }
  }

  const fixtureIndex = parseInt(searchParams.get('index') || '0', 10);

  try {
    // Safety guard: Fixture mnemonic derivation is only permitted on regtest and testnet.
    // On mainnet, public test mnemonics are strictly prohibited by SDK guard.
    if (network === 'mainnet') {
      return NextResponse.json({
        success: true,
        accountIndex: fixtureIndex,
        network,
        endpoint,
        unifiedAddress: 'Mainnet Watch-Only (Import UFVK to view)',
        transparentAddress: undefined,
        ufvk: undefined,
        isWatchOnly: true,
        balances: {
          orchard: '0',
          ironwood: '0',
          sapling: '0',
          transparent: '0',
          total: '0',
          confirmed: { orchard: '0', ironwood: '0', sapling: '0', transparent: '0', total: '0' },
          pending: { orchard: '0', ironwood: '0', sapling: '0', transparent: '0', total: '0' },
        },
        notes: [],
        notice: 'Mainnet operates strictly watch-only. Import an explicit UFVK to monitor an account.',
      });
    }

    const acct = dev.fixtures.account(fixtureIndex, network as any);
    const ua = acct.getUnifiedAddress();
    const ufvk = acct.getUnifiedFullViewingKey();

    let balances: any = {
      orchard: '0',
      ironwood: '0',
      sapling: '0',
      transparent: '0',
      total: '0',
      confirmed: { orchard: '0', ironwood: '0', sapling: '0', transparent: '0', total: '0' },
      pending: { orchard: '0', ironwood: '0', sapling: '0', transparent: '0', total: '0' },
    };
    let incomingNotes: any[] = [];

    // Attempt balance and note scanning for regtest (small height, safe to scan synchronously)
    if (network === 'regtest') {
      try {
        const client = createClient({ endpoint, network });
        const rawBalances = await getBalance(client, acct);
        balances = {
          orchard: rawBalances.orchard.toString(),
          ironwood: rawBalances.ironwood.toString(),
          sapling: rawBalances.sapling.toString(),
          transparent: rawBalances.transparent.toString(),
          total: rawBalances.total.toString(),
          confirmed: {
            orchard: rawBalances.confirmed.orchard.toString(),
            ironwood: rawBalances.confirmed.ironwood.toString(),
            sapling: rawBalances.confirmed.sapling.toString(),
            transparent: rawBalances.confirmed.transparent.toString(),
            total: rawBalances.confirmed.total.toString(),
          },
          pending: {
            orchard: rawBalances.pending.orchard.toString(),
            ironwood: rawBalances.pending.ironwood.toString(),
            sapling: rawBalances.pending.sapling.toString(),
            transparent: rawBalances.pending.transparent.toString(),
            total: rawBalances.pending.total.toString(),
          },
        };
        const { notes } = await detectIncoming(client, acct);
        incomingNotes = notes.map((n) => ({
          ...n,
          value: n.value.toString(),
        }));
        await client.close();
      } catch (e: any) {
        // Indexer may be starting or offline
      }
    }

    const transparentAddress = acct.getTransparentAddress ? acct.getTransparentAddress() : undefined;

    return NextResponse.json({
      success: true,
      accountIndex: fixtureIndex,
      preset: presetParam || undefined,
      network,
      endpoint,
      unifiedAddress: ua,
      transparentAddress,
      ufvk,
      isWatchOnly: network !== 'regtest',
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
