import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { NETWORK_PRESETS, PresetId } from '../../endpoints';

export async function GET() {
  const configPath = path.resolve(process.cwd(), 'zcash.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return NextResponse.json({ success: true, config: data });
    } catch (e) {}
  }

  const network = process.env.ZCASH_NETWORK || 'regtest';
  const endpoint =
    process.env.ZCASH_ENDPOINT ||
    (network === 'regtest' ? '127.0.0.1:39067' : 'testnet.zec.rocks:443');

  let preset: PresetId = 'regtest-nu7';
  if (process.env.ZCASH_PRESET && NETWORK_PRESETS[process.env.ZCASH_PRESET as PresetId]) {
    preset = process.env.ZCASH_PRESET as PresetId;
  } else if (network === 'testnet') {
    preset = endpoint.includes('39167') ? 'testnet-local' : 'testnet';
  } else if (network === 'mainnet') {
    preset = 'mainnet';
  } else if (network === 'regtest') {
    preset = endpoint.includes('28137') ? 'regtest-z3' : 'regtest-nu7';
  }

  return NextResponse.json({
    success: true,
    config: {
      network,
      endpoint,
      connectionMode: process.env.ZCASH_CONNECTION_MODE || 'local',
      preset,
    },
  });
}
