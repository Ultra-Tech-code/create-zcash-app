import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { getExpectedBranchId } from '@zcash-app/core';
import { ClientConfig, Network } from './types.js';

export const PINNED_NU7_ACTIVATION_HEIGHT = 4465026;
export const PINNED_NU7_ACTIVATION_HASH =
  '000089ba27100beede16d64b34e3d1b626b428cb7ee9fe6dcfdc217ce24e78af';
export const DEPRECATED_OLD_CHAIN_HASH =
  '0713a6429dc1cef50224668082022ca8881593e09a3170717e6a725491c03b96';

export class ChainIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainIdentityError';
  }
}

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

export interface TreeState {
  network: string;
  height: string | number;
  hash: string;
  time: number;
  saplingTree: string;
  orchardTree: string;
  ironwoodTree: string;
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
  txid?: Buffer;
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
  public readonly safeEndpoint: string;
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

    const hasHttps = config.endpoint.startsWith('https://');
    const isTls =
      hasHttps ||
      config.endpoint.endsWith(':443') ||
      (config as any).tls === true;

    let cleanEndpoint = config.endpoint.replace(/^https?:\/\//, '');
    if (!cleanEndpoint.includes(':')) {
      cleanEndpoint = isTls ? `${cleanEndpoint}:443` : `${cleanEndpoint}:9067`;
    }

    this.safeEndpoint = `${isTls ? 'https:' : 'http:'}//${cleanEndpoint}`;

    this.client = new Service(
      cleanEndpoint,
      isTls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
    );
  }

  /**
   * Asserts chain identity on connect:
   * 1. Derives expected consensus branch ID from the crate for the server tip height.
   * 2. Asserts server's consensusBranchId matches the crate's expectation.
   * 3. For testnet, checks the pinned block hash at NU7 activation height 4,465,026,
   *    failing closed with distinct errors for legacy chain (0713a642...) or hash mismatch.
   */
  public async assertChainIdentity(): Promise<{
    consensusBranchId: string;
    expectedBranchId: string;
    blockHeight: number;
    activationBlockHash?: string;
  }> {
    const info = await this.getInfo();
    const height = Number(info.blockHeight);
    const expectedBranchId = getExpectedBranchId(this.config.network, height);
    const branchReceived = (info.consensusBranchId ?? '').toLowerCase().replace(/^0x/, '');

    if (branchReceived !== expectedBranchId.toLowerCase()) {
      throw new ChainIdentityError(
        `Network ${this.config.network} consensus branch mismatch at tip ${height}: expected 0x${expectedBranchId}, received 0x${info.consensusBranchId}`
      );
    }

    let activationBlockHash: string | undefined;
    if (this.config.network === 'testnet' && height >= PINNED_NU7_ACTIVATION_HEIGHT) {
      const header = await this.getBlockHeader(PINNED_NU7_ACTIVATION_HEIGHT);
      const hashRev = Buffer.from(header.hash).reverse().toString('hex');
      activationBlockHash = hashRev;

      if (hashRev.toLowerCase() === DEPRECATED_OLD_CHAIN_HASH.toLowerCase()) {
        throw new ChainIdentityError(
          `Server is on deprecated legacy testnet chain (block ${PINNED_NU7_ACTIVATION_HEIGHT} hash ${hashRev}). Expected canonical NU7 activation hash ${PINNED_NU7_ACTIVATION_HASH}.`
        );
      }

      if (hashRev.toLowerCase() !== PINNED_NU7_ACTIVATION_HASH.toLowerCase()) {
        throw new ChainIdentityError(
          `Block ${PINNED_NU7_ACTIVATION_HEIGHT} hash mismatch: expected ${PINNED_NU7_ACTIVATION_HASH}, received ${hashRev}`
        );
      }
    }

    return {
      consensusBranchId: branchReceived,
      expectedBranchId,
      blockHeight: height,
      activationBlockHash,
    };
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

  public getRawBlockRange(startHeight: number, endHeight: number): AsyncIterable<Buffer> {
    const rawStream = this.client.makeServerStreamRequest(
      '/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlockRange',
      (arg: any) => this.client.GetBlockRange.requestSerialize(arg),
      (buffer: Buffer) => buffer,
      { start: { height: startHeight }, end: { height: endHeight } }
    );
    return rawStream as unknown as AsyncIterable<Buffer>;
  }

  public getTreeState(height: number): Promise<TreeState> {
    return new Promise((resolve, reject) => {
      this.client.GetTreeState({ height }, (err: any, response: TreeState) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  public getBlockHeader(height: number): Promise<{ hash: Buffer; prevHash: Buffer; height: number }> {
    return new Promise((resolve, reject) => {
      this.client.GetBlock({ height }, (err: any, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            hash: Buffer.from(response.hash),
            prevHash: Buffer.from(response.prevHash),
            height: Number(response.height),
          });
        }
      });
    });
  }

  public sendTransaction(rawTx: Buffer): Promise<{ errorCode: number; errorMessage: string }> {
    return new Promise((resolve, reject) => {
      this.client.SendTransaction({ data: rawTx, height: 0 }, (err: any, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            errorCode: response?.errorCode ?? 0,
            errorMessage: response?.errorMessage ?? '',
          });
        }
      });
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
