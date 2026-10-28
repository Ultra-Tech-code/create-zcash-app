import { NextResponse } from 'next/server';
import { createClient, dev, getBalance, detectIncoming, accountFromUfvk } from '@zcash-app/sdk';
import { NETWORK_PRESETS, Network, PresetId, ALLOWED_ENDPOINTS } from '../../endpoints';
import { getSession, getSessionIdFromRequest } from '../../session';

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
    const sessionId = getSessionIdFromRequest(request);
    const sessionData = sessionId ? getSession(sessionId) : undefined;
    const sessionUfvk = sessionData && sessionData.network === network ? sessionData.ufvk : null;

    // Safety guard: Fixture mnemonic derivation is only permitted on regtest.
    // On mainnet and testnet, public test mnemonics are strictly prohibited; accounts are watch-only.
    if (network === 'mainnet' || network === 'testnet') {
      if (sessionUfvk) {
        const watchAcct = accountFromUfvk(sessionUfvk, network);
        const ua = watchAcct.getUnifiedAddress();
        return NextResponse.json({
          success: true,
          status: 'ready',
          message: `Watch-only account active on ${network}`,
          accountIndex: fixtureIndex,
          preset: presetParam || undefined,
          network,
          endpoint,
          unifiedAddress: ua,
          transparentAddress: null,
          ufvk: sessionUfvk,
          isWatchOnly: true,
          hasImportedKey: true,
          birthday: sessionData?.birthday,
          balances: null,
          notes: [],
        });
      }

      return NextResponse.json({
        success: true,
        status: 'ready',
        message: `${network === 'mainnet' ? 'Mainnet' : 'Testnet'} is watch-only in this dashboard. Public fixture mnemonics are refused. Import a Unified Full Viewing Key (UFVK) to view account history.`,
        accountIndex: fixtureIndex,
        preset: presetParam || undefined,
        network,
        endpoint,
        unifiedAddress: null,
        transparentAddress: null,
        ufvk: null,
        isWatchOnly: true,
        hasImportedKey: false,
        balances: null,
        notes: [],
      });
    }

    const acct = dev.fixtures.account(fixtureIndex, network as any);
    const ua = acct.getUnifiedAddress();
    const ufvk = acct.getUnifiedFullViewingKey();
    const transparentAddress = acct.getTransparentAddress ? acct.getTransparentAddress() : undefined;

    let balances: any = null;
    let incomingNotes: any[] = [];
    let status: 'ready' | 'syncing' | 'error' = 'ready';
    let message = 'Account ready and synchronized';

    // Balance and note scanning for regtest
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
        const errMsg = e?.message || String(e);
        if (errMsg.toLowerCase().includes('syncing') || errMsg.toLowerCase().includes('catching up')) {
          status = 'syncing';
          message = `Node is syncing: ${errMsg}`;
        } else {
          status = 'error';
          message = `Failed to query node on ${endpoint}: ${errMsg}`;
        }
        // Do NOT swallow errors into silent zeros; keep balances as null
        balances = null;
        incomingNotes = [];
      }
    }

    return NextResponse.json({
      success: status !== 'error',
      status,
      message,
      accountIndex: fixtureIndex,
      preset: presetParam || undefined,
      network,
      endpoint,
      unifiedAddress: ua,
      transparentAddress,
      ufvk,
      isWatchOnly: false,
      balances,
      notes: incomingNotes,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        status: 'error',
        message: err.message || 'Account derivation failed',
        error: err.message || 'Account derivation failed',
      },
      { status: 400 }
    );
  }
}
