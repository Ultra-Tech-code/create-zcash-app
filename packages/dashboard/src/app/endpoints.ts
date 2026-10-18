export type Network = 'regtest' | 'testnet' | 'mainnet';

export const NETWORK_ENDPOINTS: Record<Network, string> = {
  regtest: '127.0.0.1:8137',
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};
