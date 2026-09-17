import {
  BitcoinAddressInfo,
  BitcoinScriptInfo,
  BitcoinTxInfo,
  BitcoinTxStatus,
  BitcoinUTxO,
  IBitcoinProvider,
} from "./types/bitcoin";

export type MaestroBitcoinNetwork = "mainnet" | "testnet";

export interface MaestroBitcoinConfig {
  apiKey: string;
  network: MaestroBitcoinNetwork;
}

const MAESTRO_BITCOIN_UNSUPPORTED =
  "Maestro Bitcoin is no longer supported and will be removed in a later version. Use BlockstreamBitcoinProvider instead.";

function maestroBitcoinUnsupported(): never {
  throw new Error(MAESTRO_BITCOIN_UNSUPPORTED);
}

/**
 * @deprecated Maestro Bitcoin is no longer supported and will be removed in a later version.
 */
export class MaestroBitcoinProvider implements IBitcoinProvider {
  /**
   * @deprecated Maestro Bitcoin is no longer supported. Constructor params are kept for compatibility and will be removed in a later version.
   */
  constructor(_config: MaestroBitcoinConfig) {}

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchAddressInfo(_address: string): Promise<BitcoinAddressInfo> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchAddressUTxOs(_address: string): Promise<BitcoinUTxO[]> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchUTxO(_txid: string, _vout?: number): Promise<BitcoinUTxO[]> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchAddressTxs(
    _address: string,
    _lastSeenTxid?: string,
  ): Promise<BitcoinTxInfo[]> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchTxInfo(_txid: string): Promise<BitcoinTxStatus> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchFeeEstimates(_blocks: number): Promise<number> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchScriptInfo(_hash: string): Promise<BitcoinScriptInfo> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchScriptUTxOs(_hash: string): Promise<BitcoinUTxO[]> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async fetchScriptTxs(
    _hash: string,
    _lastSeenTxid?: string,
  ): Promise<BitcoinTxInfo[]> {
    return maestroBitcoinUnsupported();
  }

  /**
   * @deprecated Maestro Bitcoin is no longer supported.
   */
  async submitTx(_txHex: string): Promise<string> {
    return maestroBitcoinUnsupported();
  }
}
