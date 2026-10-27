export type Network = 'regtest' | 'testnet' | 'mainnet';

export type PresetId =
  | 'regtest-nu7'
  | 'regtest-z3'
  | 'testnet'
  | 'testnet-local'
  | 'mainnet';

export interface NetworkPreset {
  id: PresetId;
  label: string;
  network: Network;
  endpoint: string;
  description: string;
  isLocal?: boolean;
  miningRpcUrl?: string;
  supportsZalletFaucet?: boolean;
}

export const NETWORK_PRESETS: Record<PresetId, NetworkPreset> = {
  'regtest-nu7': {
    id: 'regtest-nu7',
    label: 'Regtest - NU7 (Zebra+lightwalletd, 127.0.0.1:39067)',
    network: 'regtest',
    endpoint: '127.0.0.1:39067',
    description: 'Standalone Zebra 7.0.0 + Lightwalletd with NU7 active at block 1',
    isLocal: true,
    miningRpcUrl: 'http://127.0.0.1:39232',
    supportsZalletFaucet: false,
  },
  'regtest-z3': {
    id: 'regtest-z3',
    label: 'Regtest - Z3 NU6.3 (Zaino, 127.0.0.1:28137)',
    network: 'regtest',
    endpoint: '127.0.0.1:28137',
    description: 'Z3 stack with Zebra 7 + Zaino + Zallet (NU6.3)',
    isLocal: true,
    miningRpcUrl: 'http://127.0.0.1:8181',
    supportsZalletFaucet: true,
  },
  testnet: {
    id: 'testnet',
    label: 'Testnet (testnet.zec.rocks:443)',
    network: 'testnet',
    endpoint: 'testnet.zec.rocks:443',
    description: 'Public Lightwalletd on Zcash testnet',
    isLocal: false,
    supportsZalletFaucet: false,
  },
  'testnet-local': {
    id: 'testnet-local',
    label: 'Testnet - local lightwalletd (127.0.0.1:39167, if reachable)',
    network: 'testnet',
    endpoint: '127.0.0.1:39167',
    description: 'Local lightwalletd connected to local testnet Zebra node',
    isLocal: true,
    supportsZalletFaucet: false,
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet (zec.rocks:443)',
    network: 'mainnet',
    endpoint: 'zec.rocks:443',
    description: 'Public Lightwalletd on Zcash mainnet (Watch-only)',
    isLocal: false,
    supportsZalletFaucet: false,
  },
};

export const ALLOWED_ENDPOINTS = [
  '127.0.0.1:39067',
  '127.0.0.1:39167',
  '127.0.0.1:28137',
  'testnet.zec.rocks:443',
  'zec.rocks:443',
];

export const NETWORK_ENDPOINTS: Record<Network, string> = {
  regtest: '127.0.0.1:39067',
  testnet: 'testnet.zec.rocks:443',
  mainnet: 'zec.rocks:443',
};
