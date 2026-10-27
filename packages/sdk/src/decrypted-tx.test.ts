import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { decryptTransaction } from './decrypted-tx.js';
import { accountFromMnemonic } from './keys.js';

describe('decryptTransaction SDK helper', () => {
  it('rejects invalid UFVK with descriptive error', () => {
    expect(() => {
      decryptTransaction('invalid_ufvk', 'regtest', Buffer.from([1, 2, 3]), 100);
    }).toThrow(/Failed to decode UFVK/);
  });

  it('rejects malformed transaction bytes with deserialization error', () => {
    const acct = accountFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      0,
      'regtest',
    );
    expect(() => {
      decryptTransaction(acct.getUnifiedFullViewingKey(), 'regtest', Buffer.from([0, 1, 2, 3]), 100);
    }).toThrow(/Failed to deserialize transaction bytes/);
  });

  it('decrypts testnet raw tx hex with Wallet B showing INCOMING 1,000,000 zat', () => {
    const accountsPath = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
    const qnJsonPath = path.resolve(
      __dirname,
      '../../core/tests/logs/chain_queries/quicknode_getrawtransaction.json',
    );

    if (!fs.existsSync(accountsPath) || !fs.existsSync(qnJsonPath)) {
      console.warn('Skipping testnet file test: accounts.json or quicknode json not present');
      return;
    }

    const accts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    const qnData = JSON.parse(fs.readFileSync(qnJsonPath, 'utf8'));

    const rawHex = qnData.result.hex;
    const height = qnData.result.height;
    const rawBytes = Buffer.from(rawHex, 'hex');

    // Wallet B (Recipient)
    const walletB = accountFromMnemonic(accts.mnemonicB, 0, 'testnet');
    const decB = decryptTransaction(walletB.getUnifiedFullViewingKey(), 'testnet', rawBytes, height);

    expect(decB.txid).toBe('8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a');
    expect(decB.fee).toBe(10000n);
    expect(decB.consensusBranchId).toBe('77190ad9');
    expect(decB.incoming.length).toBe(1);
    expect(decB.incoming[0].value).toBe(1000000n);
    expect(decB.incoming[0].isChange).toBe(false);
    expect(decB.outgoing.length).toBe(0);

    // Wallet A (Sender)
    const walletA = accountFromMnemonic(accts.mnemonicA, 0, 'testnet');
    const decA = decryptTransaction(walletA.getUnifiedFullViewingKey(), 'testnet', rawBytes, height);

    expect(decA.txid).toBe('8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a');
    expect(decA.fee).toBe(10000n);
    expect(decA.outgoing.length).toBe(1);
    expect(decA.outgoing[0].value).toBe(1000000n);
    expect(decA.outgoing[0].recipient).toBe(decB.incoming[0].recipient);
    expect(decA.incoming.length).toBe(1);
    expect(decA.incoming[0].isChange).toBe(true);
    expect(decA.incoming[0].value).toBe(8990000n);
  });
});
