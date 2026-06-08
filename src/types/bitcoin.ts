
export type BitcoinChainStats = {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
};

export type BitcoinMempoolStats = {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
};

export type BitcoinAddressInfo = {
  address: string;
  chain_stats: BitcoinChainStats;
  mempool_stats: BitcoinMempoolStats;
};

export type BitcoinScriptInfo = {
  scripthash: string;
  chain_stats: BitcoinChainStats;
  mempool_stats: BitcoinMempoolStats;
};

export type BitcoinTxStatus = {
  confirmed: boolean;
  block_height: number;
  block_hash: string;
  block_time: number;
};

export type BitcoinUTxO = {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
};

export type BitcoinTxInfo = {
  txid: string;
  version: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address: string;
      value: number;
    };
    scriptsig: string;
    scriptsig_asm: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
  }[];
  vout: {
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address: string;
    value: number;
  }[];
  size: number;
  weight: number;
  fee: number;
  status: BitcoinTxStatus;
};

/**
 * Read-only chain data queries for Bitcoin addresses and scripts.
 * Mirrors `IBitcoinFetcher` from `@meshsdk/wallet` — structurally compatible.
 */
export interface IBitcoinFetcher {
  fetchAddressInfo(address: string): Promise<BitcoinAddressInfo>;
  fetchAddressUTxOs(address: string): Promise<BitcoinUTxO[]>;
  fetchUTxOs(txid: string, vout?: number): Promise<BitcoinUTxO[]>;
  fetchAddressTxs(address: string, lastSeenTxid?: string): Promise<BitcoinTxInfo[]>;
  fetchTxInfo(txid: string): Promise<BitcoinTxStatus>;
  fetchFeeEstimates(blocks: number): Promise<number>;
  fetchScriptInfo?(hash: string): Promise<BitcoinScriptInfo>;
  fetchScriptUTxOs?(hash: string): Promise<BitcoinUTxO[]>;
  fetchScriptTxs?(hash: string, lastSeenTxid?: string): Promise<BitcoinTxInfo[]>;
}

export interface IBitcoinSubmitter {
  submitTx(tx: string): Promise<string>;
}

export interface IBitcoinProvider extends IBitcoinFetcher, IBitcoinSubmitter {}
