import { describe, it, expect, vi } from 'vitest';
import {
  createClient,
  ChainIdentityError,
  PINNED_NU7_ACTIVATION_HEIGHT,
  PINNED_NU7_ACTIVATION_HASH,
  DEPRECATED_OLD_CHAIN_HASH,
} from './client.js';

describe('ZcashClient URL & Scheme Normalization', () => {
  it('handles https endpoint with explicit 443 port', () => {
    const c = createClient({ endpoint: 'https://testnet.zec.rocks:443', network: 'testnet' });
    expect(c.safeEndpoint).toBe('https://testnet.zec.rocks:443');
    c.close();
  });

  it('handles https endpoint without port defaulting to 443', () => {
    const c = createClient({ endpoint: 'https://testnet.zec.rocks', network: 'testnet' });
    expect(c.safeEndpoint).toBe('https://testnet.zec.rocks:443');
    c.close();
  });

  it('handles plaintext host:port endpoint', () => {
    const c = createClient({ endpoint: '127.0.0.1:8137', network: 'testnet' });
    expect(c.safeEndpoint).toBe('http://127.0.0.1:8137');
    c.close();
  });

  it('handles plaintext host without port defaulting to 9067', () => {
    const c = createClient({ endpoint: '127.0.0.1', network: 'testnet' });
    expect(c.safeEndpoint).toBe('http://127.0.0.1:9067');
    c.close();
  });
});

describe('Chain Identity Guard', () => {
  it('accepts a canonical NU7 testnet server with derived branch and pinned activation hash', async () => {
    const client = createClient({ endpoint: 'https://testnet.zec.rocks:443', network: 'testnet' });

    vi.spyOn(client, 'getInfo').mockResolvedValue({
      version: 'v0.5.4',
      vendor: 'ECC LightWalletD',
      taddrSupport: true,
      chainName: 'test',
      saplingActivationHeight: '280000',
      consensusBranchId: '77190ad9',
      blockHeight: '4540587',
    });

    const canonicalHashBuf = Buffer.from(PINNED_NU7_ACTIVATION_HASH, 'hex').reverse();
    vi.spyOn(client, 'getBlockHeader').mockResolvedValue({
      hash: canonicalHashBuf,
      prevHash: Buffer.alloc(32),
      height: PINNED_NU7_ACTIVATION_HEIGHT,
    });

    const result = await client.assertChainIdentity();
    expect(result.consensusBranchId).toBe('77190ad9');
    expect(result.expectedBranchId).toBe('77190ad9');
    expect(result.blockHeight).toBe(4540587);
    expect(result.activationBlockHash).toBe(PINNED_NU7_ACTIVATION_HASH);

    await client.close();
  });

  it('rejects a server with consensus branch ID mismatch derived from crate', async () => {
    const client = createClient({ endpoint: '127.0.0.1:8137', network: 'testnet' });

    // Server tip is 4.54M (post-NU7) but reporting pre-NU7 branch 37a5165b
    vi.spyOn(client, 'getInfo').mockResolvedValue({
      version: 'v0.5.4',
      vendor: 'Zebra',
      taddrSupport: true,
      chainName: 'test',
      saplingActivationHeight: '280000',
      consensusBranchId: '37a5165b',
      blockHeight: '4540587',
    });

    await expect(client.assertChainIdentity()).rejects.toThrow(ChainIdentityError);
    await expect(client.assertChainIdentity()).rejects.toThrow(
      /Network testnet consensus branch mismatch at tip 4540587: expected 0x77190ad9, received 0x37a5165b/
    );

    await client.close();
  });

  it('fails closed with a distinct error when server reports the deprecated legacy activation hash', async () => {
    const client = createClient({ endpoint: '127.0.0.1:8137', network: 'testnet' });

    vi.spyOn(client, 'getInfo').mockResolvedValue({
      version: 'v0.5.4',
      vendor: 'ECC LightWalletD',
      taddrSupport: true,
      chainName: 'test',
      saplingActivationHeight: '280000',
      consensusBranchId: '77190ad9',
      blockHeight: '4540587',
    });

    const oldChainHashBuf = Buffer.from(DEPRECATED_OLD_CHAIN_HASH, 'hex').reverse();
    vi.spyOn(client, 'getBlockHeader').mockResolvedValue({
      hash: oldChainHashBuf,
      prevHash: Buffer.alloc(32),
      height: PINNED_NU7_ACTIVATION_HEIGHT,
    });

    await expect(client.assertChainIdentity()).rejects.toThrow(ChainIdentityError);
    await expect(client.assertChainIdentity()).rejects.toThrow(
      /Server is on deprecated legacy testnet chain \(block 4465026 hash 0713a6429dc1cef50224668082022ca8881593e09a3170717e6a725491c03b96\)/
    );

    await client.close();
  });

  it('fails closed when activation block hash does not match pinned value', async () => {
    const client = createClient({ endpoint: '127.0.0.1:8137', network: 'testnet' });

    vi.spyOn(client, 'getInfo').mockResolvedValue({
      version: 'v0.5.4',
      vendor: 'ECC LightWalletD',
      taddrSupport: true,
      chainName: 'test',
      saplingActivationHeight: '280000',
      consensusBranchId: '77190ad9',
      blockHeight: '4540587',
    });

    const randomHashBuf = Buffer.from('ff'.repeat(32), 'hex');
    vi.spyOn(client, 'getBlockHeader').mockResolvedValue({
      hash: randomHashBuf,
      prevHash: Buffer.alloc(32),
      height: PINNED_NU7_ACTIVATION_HEIGHT,
    });

    await expect(client.assertChainIdentity()).rejects.toThrow(ChainIdentityError);
    await expect(client.assertChainIdentity()).rejects.toThrow(
      /Block 4465026 hash mismatch: expected 000089ba27100beede16d64b34e3d1b626b428cb7ee9fe6dcfdc217ce24e78af/
    );

    await client.close();
  });

  it('derives expected branch ID for regtest default (NU6.3) and opt-in (NU7) from crate params', async () => {
    // 1. Default regtest: NU6.3 (0x37a5165b)
    const clientDefault = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });

    vi.spyOn(clientDefault, 'getInfo').mockResolvedValue({
      version: '0.10.0',
      vendor: 'Zaino',
      taddrSupport: true,
      chainName: 'regtest',
      saplingActivationHeight: '1',
      consensusBranchId: '37a5165b',
      blockHeight: '10',
    });

    const resultDefault = await clientDefault.assertChainIdentity();
    expect(resultDefault.consensusBranchId).toBe('37a5165b');
    expect(resultDefault.expectedBranchId).toBe('37a5165b');

    await clientDefault.close();

    // 2. Opt-in regtest: NU7 (0x77190ad9) via regtestNu7 flag
    const clientNu7 = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest', regtestNu7: true });

    vi.spyOn(clientNu7, 'getInfo').mockResolvedValue({
      version: '0.10.2',
      vendor: 'Zaino',
      taddrSupport: true,
      chainName: 'regtest',
      saplingActivationHeight: '1',
      consensusBranchId: '77190ad9',
      blockHeight: '10',
    });

    const resultNu7 = await clientNu7.assertChainIdentity();
    expect(resultNu7.consensusBranchId).toBe('77190ad9');
    expect(resultNu7.expectedBranchId).toBe('77190ad9');

    await clientNu7.close();
  });
});
