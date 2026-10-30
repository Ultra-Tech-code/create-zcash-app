import { NextResponse } from 'next/server';
import {
  accountFromMnemonic,
  createClient,
  generateMnemonic,
  getBalance,
} from '@zcash-app/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Network = 'regtest' | 'testnet' | 'mainnet';

const DEFAULT_ENDPOINTS: Record<Network, string> = {
  regtest: '127.0.0.1:28137',
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};

// A mnemonic generated on first use is kept for the lifetime of this server process so the
// address stays stable across refreshes. It exists only in memory and is never written to disk.
let processMnemonic: string | null = null;

function resolveNetwork(): Network {
  const value = (process.env.ZCASH_NETWORK ?? 'regtest').trim().toLowerCase();
  return value === 'testnet' || value === 'mainnet' ? value : 'regtest';
}

function parseBirthday(): number | undefined {
  const raw = (process.env.ZCASH_BIRTHDAY ?? '').trim();
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : undefined;
}

function zatoshiString(value: bigint): string {
  return value.toString();
}

export async function GET() {
  const network = resolveNetwork();
  const endpoint = (process.env.ZCASH_ENDPOINT ?? '').trim() || DEFAULT_ENDPOINTS[network];
  const configuredMnemonic = (process.env.ZCASH_MNEMONIC ?? '').trim();

  if (!configuredMnemonic && !processMnemonic) {
    processMnemonic = generateMnemonic();
  }
  const mnemonic = configuredMnemonic || processMnemonic!;
  const birthday = parseBirthday();

  let account;
  try {
    account = accountFromMnemonic(mnemonic, 0, network);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Could not derive an account: ${message}` },
      { status: 500 }
    );
  }

  let address: string | null = null;
  try {
    address = account.getUnifiedAddress();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Could not derive a unified address: ${message}` },
      { status: 500 }
    );
  }

  let balance: {
    total: string;
    ironwood: string;
    orchard: string;
    sapling: string;
    transparent: string;
  } | null = null;
  let balanceError: string | null = null;

  const client = createClient({ endpoint, network });
  try {
    const raw = await getBalance(client, account, { sinceHeight: birthday });
    balance = {
      total: zatoshiString(raw.total),
      ironwood: zatoshiString(raw.ironwood),
      orchard: zatoshiString(raw.orchard),
      sapling: zatoshiString(raw.sapling),
      transparent: zatoshiString(raw.transparent),
    };
  } catch (err) {
    // A node that is down or still syncing is normal in development; report it instead of
    // pretending the balance is zero.
    balanceError = err instanceof Error ? err.message : String(err);
  } finally {
    await client.close().catch(() => {});
  }

  return NextResponse.json({
    success: true,
    network,
    endpoint,
    address,
    birthday: birthday ?? null,
    generatedMnemonic: !configuredMnemonic,
    balance,
    balanceError,
    message: balanceError
      ? `Address derived, but the balance could not be read from ${endpoint}`
      : 'Account derived and balance read from the indexer',
  });
}
