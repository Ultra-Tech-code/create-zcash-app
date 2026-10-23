import { Account, TxResult } from './types.js';
import { ZcashClient } from './client.js';
import { accountFromMnemonic } from './keys.js';

export namespace dev {
  export const KNOWN_TEST_MNEMONICS = [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
  ];

  export const fixtures = {
    mnemonics: KNOWN_TEST_MNEMONICS,
    account(index: number, network: 'regtest' | 'testnet' | 'mainnet' = 'regtest'): Account {
      if (network === 'mainnet') {
        throw new Error(
          'Security Error: Test fixture mnemonics are publicly known and strictly prohibited on mainnet. Import an explicit UFVK or private seed for production.'
        );
      }
      const phrase = fixtures.mnemonics[index % fixtures.mnemonics.length];
      const acct = accountFromMnemonic(phrase, 0, network);
      return acct;
    },
  };

  export async function mine(client: ZcashClient, blocks: number): Promise<void> {
    if (client.config.network !== 'regtest') {
      throw new Error('mine is only available on regtest');
    }
    // Call Zebra JSON-RPC generate
    const res = await fetch('http://127.0.0.1:8181', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'zcash-dev-mine',
        method: 'generate',
        params: [blocks],
      }),
    });

    if (!res.ok) {
      throw new Error(`Zebra mining HTTP error: ${res.statusText}`);
    }

    const data: any = await res.json();
    if (data.error) {
      throw new Error(`Zebra mining JSON-RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    }
  }

  export async function fund(
    client: ZcashClient,
    to: string,
    value: bigint
  ): Promise<TxResult> {
    if (client.config.network !== 'regtest') {
      throw new Error('fund is only available on regtest');
    }

    // 1. Get sender UA from Zallet
    const addrRes = await fetch('http://127.0.0.1:8181', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'fund-listaddresses',
        method: 'listaddresses',
        params: [],
      }),
    });
    if (!addrRes.ok) throw new Error(`Zallet listaddresses error: ${addrRes.statusText}`);
    const addrData: any = await addrRes.json();
    const accounts = addrData?.result?.[0]?.unified;
    const senderUa = accounts?.[0]?.addresses?.[0]?.address;
    if (!senderUa) {
      throw new Error('No sender address found in Zallet regtest wallet');
    }

    // 2. Call z_sendmany
    const amountZec = Number(value) / 1e8;
    const sendRes = await fetch('http://127.0.0.1:8181', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'fund-sendmany',
        method: 'z_sendmany',
        params: [
          senderUa,
          [{ address: to, amount: amountZec }],
        ],
      }),
    });
    if (!sendRes.ok) throw new Error(`Zallet z_sendmany error: ${sendRes.statusText}`);
    const sendData: any = await sendRes.json();
    if (sendData.error) {
      throw new Error(`Zallet z_sendmany error: ${sendData.error.message || JSON.stringify(sendData.error)}`);
    }
    const opid = sendData.result;

    // 3. Poll z_getoperationstatus for success
    let txid = '';
    for (let attempts = 0; attempts < 30; attempts++) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = await fetch('http://127.0.0.1:8181', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'fund-opstatus',
          method: 'z_getoperationstatus',
          params: [[opid]],
        }),
      });
      const statusData: any = await statusRes.json();
      const op = statusData?.result?.[0];
      if (op?.status === 'success') {
        txid = op.result?.txid;
        break;
      }
      if (op?.status === 'failed') {
        throw new Error(`Zallet send operation failed: ${op.error?.message || JSON.stringify(op.error)}`);
      }
    }

    if (!txid) {
      throw new Error(`Timed out waiting for send operation ${opid} to complete`);
    }

    // 4. Mine 1 block to confirm the transaction
    await mine(client, 1);

    return {
      txid,
      fee: 10000n,
    };
  }

  export async function reset(client: ZcashClient): Promise<void> {
    if (client.config.network !== 'regtest') {
      throw new Error('reset is only available on regtest');
    }
    // No-op until regtest chain wipe helper is attached
  }

  export async function faucet(
    address: string,
    opts?: { ztapUrl?: string }
  ): Promise<{ status: 'sent' | 'open-url'; txid?: string; url?: string }> {
    const url = opts?.ztapUrl ?? 'http://127.0.0.1:3000/faucet';
    return {
      status: 'open-url',
      url: `${url}?address=${encodeURIComponent(address)}`,
    };
  }
}

export const testkit = {
  fixtures: dev.fixtures,
  async withRegtest(
    fn: (ctx: { client: ZcashClient; fund: typeof dev.fund }) => Promise<void>
  ): Promise<void> {
    const client = new ZcashClient({
      endpoint: '127.0.0.1:8137',
      network: 'regtest',
    });
    try {
      await fn({ client, fund: dev.fund });
    } finally {
      await client.close();
    }
  },
};
