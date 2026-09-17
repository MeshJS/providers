import {
  AccountInfo,
  Action,
  Asset,
  AssetMetadata,
  BlockInfo,
  GovernanceProposalInfo,
  IEvaluator,
  IFetcher,
  IFetcherOptions,
  IListener,
  ISubmitter,
  Protocol,
  TransactionInfo,
  UTxO,
} from "@meshsdk/common";

export type MaestroSupportedNetworks = "Mainnet" | "Preprod" | "Preview";

export interface MaestroConfig {
  network: MaestroSupportedNetworks;
  apiKey: string;
  turboSubmit?: boolean;
}

const MAESTRO_UNSUPPORTED =
  "Maestro is no longer supported and will be removed in a later version. Use another provider such as Blockfrost or Koios.";

function maestroUnsupported(): never {
  throw new Error(MAESTRO_UNSUPPORTED);
}

/**
 * @deprecated Maestro is no longer supported and will be removed in a later version.
 */
export class MaestroProvider
  implements IFetcher, ISubmitter, IEvaluator, IListener
{
  /**
   * @deprecated Maestro is no longer supported. Constructor params are kept for compatibility and will be removed in a later version.
   */
  constructor(_config: MaestroConfig) {}

  /**
   * @deprecated Maestro is no longer supported.
   */
  async evaluateTx(
    _cbor: string,
    _additionalUtxos?: UTxO[],
    _additionalTxs?: string[],
  ): Promise<Omit<Action, "data">[]> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchAccountInfo(_address: string): Promise<AccountInfo> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchAddressAssets(
    _address: string,
  ): Promise<{ [key: string]: string }> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchAddressUTxOs(_address: string, _asset?: string): Promise<UTxO[]> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchAddressTxs(
    _address: string,
    _option: IFetcherOptions = { maxPage: 100, order: "desc" },
  ): Promise<TransactionInfo[]> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchAssetAddresses(
    _asset: string,
  ): Promise<{ address: string; quantity: string }[]> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchAssetMetadata(_asset: string): Promise<AssetMetadata> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchBlockInfo(_hash: string): Promise<BlockInfo> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchCollectionAssets(
    _policyId: string,
    _cursor?: string,
  ): Promise<{ assets: Asset[]; next: string | number | null }> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchHandle(_handle: string): Promise<object> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchHandleAddress(_handle: string): Promise<string> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchProtocolParameters(_epoch = Number.NaN): Promise<Protocol> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchCostModels(_epoch?: number): Promise<number[][]> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchTxInfo(_hash: string): Promise<TransactionInfo> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchUTxOs(_hash: string, _index?: number): Promise<UTxO[]> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async fetchGovernanceProposal(
    _txHash: string,
    _certIndex: number,
  ): Promise<GovernanceProposalInfo> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async get(_url: string): Promise<any> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async post(_url: string, _body: any): Promise<any> {
    return maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  onTxConfirmed(
    _txHash: string,
    _callback: () => void,
    _limit = 100,
  ): void {
    maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  setSubmitTxToBytes(_value: boolean): void {
    maestroUnsupported();
  }

  /**
   * @deprecated Maestro is no longer supported.
   */
  async submitTx(_tx: string): Promise<string> {
    return maestroUnsupported();
  }
}
