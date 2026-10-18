import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { ClientConfig, Network } from './types.js';

export interface LightdInfo {
  version: string;
  vendor: string;
  taddrSupport: boolean;
  chainName: string;
  saplingActivationHeight: string;
  consensusBranchId: string;
  blockHeight: string;
  upgradeName?: string;
}

export interface CompactBlock {
  protoVersion: number;
  height: string | number;
  hash: Buffer;
  prevHash: Buffer;
  time: number;
  vtx: CompactTx[];
}

export interface CompactTx {
  index: string | number;
  hash: Buffer;
  fee: number;
  spends: any[];
  outputs: any[];
  actions: CompactOrchardAction[];
  ironwoodActions: CompactOrchardAction[];
}

export interface CompactOrchardAction {
  nullifier: Buffer;
  cmx: Buffer;
  ephemeralKey: Buffer;
  ciphertext?: Buffer;
  cipherText?: Buffer;
}

export class ZcashClient {
  public readonly config: ClientConfig;
  private readonly client: any;

  constructor(config: ClientConfig) {
    this.config = config;
    const protoPath = path.resolve(__dirname, '../proto/service.proto');
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [path.resolve(__dirname, '../proto')],
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const Service = protoDescriptor.cash.z.wallet.sdk.rpc.CompactTxStreamer;

    const isTls =
      config.endpoint.endsWith(':443') ||
      config.endpoint.startsWith('https://') ||
      (config as any).tls === true;

    const cleanEndpoint = config.endpoint.replace(/^https?:\/\//, '');

    this.client = new Service(
      cleanEndpoint,
      isTls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
    );
  }

  public getInfo(): Promise<LightdInfo> {
    return new Promise((resolve, reject) => {
      this.client.GetLightdInfo({}, (err: any, response: LightdInfo) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  public getBlockRange(startHeight: number, endHeight: number): AsyncIterable<CompactBlock> {
    const stream = this.client.GetBlockRange({
      start: { height: startHeight },
      end: { height: endHeight },
    });
    return stream as unknown as AsyncIterable<CompactBlock>;
  }

  public getAddressUtxos(addresses: string[], startHeight = 0, maxEntries = 0): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.client.GetAddressUtxos(
        { addresses, startHeight, maxEntries },
        (err: any, response: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(response?.addressUtxos || []);
          }
        }
      );
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      this.client.close();
      resolve();
    });
  }
}

export function createClient(config: ClientConfig): ZcashClient {
  return new ZcashClient(config);
}
