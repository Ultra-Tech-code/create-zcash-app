import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const configPath = path.resolve(process.cwd(), 'zcash.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return NextResponse.json({ success: true, config: data });
    } catch (e) {}
  }

  return NextResponse.json({
    success: true,
    config: {
      network: process.env.ZCASH_NETWORK || 'regtest',
      endpoint: process.env.ZCASH_ENDPOINT || '127.0.0.1:8137',
      connectionMode: process.env.ZCASH_CONNECTION_MODE || 'local',
    },
  });
}
