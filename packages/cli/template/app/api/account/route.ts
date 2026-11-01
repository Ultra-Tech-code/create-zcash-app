import { NextResponse } from 'next/server';
import {
  accountFromMnemonic,
  accountFromUfvk,
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

// A mnemonic generated on first use on regtest is kept for the lifetime of this server process so the
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

function parseAccountIndex(): number {
  const raw = (process.env.ZCASH_ACCOUNT_INDEX ?? '0').trim();
  const val = parseInt(raw, 10);
  return Number.isNaN(val) || val < 0 ? 0 : val;
}

function zatoshiString(value: bigint): string {
  return value.toString();
}

export async function GET() {
  const network = resolveNetwork();
  const endpoint = (process.env.ZCASH_ENDPOINT ?? '').trim() || DEFAULT_ENDPOINTS[network];
  const configuredMnemonic = (process.env.ZCASH_MNEMONIC ?? '').trim();
  const configuredUfvk = (process.env.ZCASH_UFVK ?? '').trim();
  const birthday = parseBirthday();
  const accountIndex = parseAccountIndex();

  if (network !== 'regtest' && !configuredMnemonic && !configuredUfvk) {
    return NextResponse.json(
      {
        success: false,
        error: `Neither ZCASH_MNEMONIC nor ZCASH_UFVK is configured for ${network}. Set ZCASH_MNEMONIC or ZCASH_UFVK in .env.local to access an account.`,
      },
      { status: 400 }
    );
  }

  let isGenerated = false;
  let isWatchOnly = false;
  let account;

  if (configuredMnemonic) {
    try {
      account = accountFromMnemonic(configuredMnemonic, accountIndex, network);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { success: false, error: `Could not derive an account from mnemonic: ${message}` },
        { status: 500 }
      );
    }
  } else if (configuredUfvk) {
    isWatchOnly = true;
    try {
      account = accountFromUfvk(configuredUfvk, network);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { success: false, error: `Could not derive watch-only account from UFVK: ${message}` },
        { status: 500 }
      );
    }
  } else {
    if (!processMnemonic) {
      processMnemonic = generateMnemonic();
    }
    isGenerated = true;
    try {
      account = accountFromMnemonic(processMnemonic, accountIndex, network);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { success: false, error: `Could not derive regtest account: ${message}` },
        { status: 500 }
      );
    }
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
    accountIndex,
    isWatchOnly,
    generatedMnemonic: isGenerated,
    balance,
    balanceError,
    message: balanceError
      ? `Address derived, but the balance could not be read from ${endpoint}`
      : 'Account derived and balance read from the indexer',
  });
}

export async function POST() {
  const network = resolveNetwork();
  const configuredMnemonic = (process.env.ZCASH_MNEMONIC ?? '').trim();
  const configuredUfvk = (process.env.ZCASH_UFVK ?? '').trim();

  if (configuredUfvk && !configuredMnemonic && !processMnemonic) {
    return NextResponse.json(
      {
        success: false,
        error: 'Watch-only account (UFVK) cannot spend funds. A spending key (mnemonic) is required to sign and send transactions.',
      },
      { status: 400 }
    );
  }

  if (network !== 'regtest' && !configuredMnemonic) {
    return NextResponse.json(
      {
        success: false,
        error: `No spending key configured for ${network}. Set ZCASH_MNEMONIC to send transactions.`,
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Direct API sending is not enabled. Use `zcash-dev send` CLI command to send transactions.',
    },
    { status: 400 }
  );
}
