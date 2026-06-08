import {
  BitcoinAddressInfo,
  BitcoinScriptInfo,
  BitcoinTxInfo,
  BitcoinTxStatus,
  BitcoinUTxO,
  IBitcoinProvider,
} from "./types/bitcoin";

type BlockstreamNetwork = "mainnet" | "testnet";

const BASE_URLS: Record<BlockstreamNetwork, string> = {
  mainnet: "https://blockstream.info/api",
  testnet: "https://blockstream.info/testnet/api",
};

/**
 * Bitcoin provider backed by the public Blockstream Esplora API.
 * No API key required.
 *
 * @example
 * ```ts
 * import { BlockstreamBitcoinProvider } from "@meshsdk/provider";
 * import { BitcoinHeadlessWallet } from "@meshsdk/wallet";
 *
 * const provider = new BlockstreamBitcoinProvider("testnet");
 * const wallet = await BitcoinHeadlessWallet.fromMnemonic({
 *   network: "Testnet4",
 *   mnemonic: [...],
 *   provider,
 * });
 * ```
 */
export class BlockstreamBitcoinProvider implements IBitcoinProvider {
  private readonly baseUrl: string;

  constructor(network: BlockstreamNetwork) {
    this.baseUrl = BASE_URLS[network];
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(
        `[BlockstreamBitcoinProvider] GET ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.json() as Promise<T>;
  }


  fetchAddressInfo(address: string): Promise<BitcoinAddressInfo> {
    return this.get(`/address/${address}`);
  }

  fetchAddressUTxOs(address: string): Promise<BitcoinUTxO[]> {
    return this.get(`/address/${address}/utxo`);
  }

  async fetchUTxOs(txid: string, vout?: number): Promise<BitcoinUTxO[]> {
    const [tx, outspends] = await Promise.all([
      this.get<BitcoinTxInfo>(`/tx/${txid}`),
      this.get<{ spent: boolean }[]>(`/tx/${txid}/outspends`),
    ]);
    return tx.vout
      .map((out, index) => ({ index, out, spent: outspends[index]?.spent ?? false }))
      .filter(({ index, spent }) => !spent && (vout === undefined || index === vout))
      .map(({ index, out }) => ({
        txid,
        vout: index,
        value: out.value,
        status: tx.status,
      }));
  }

  fetchAddressTxs(
    address: string,
    lastSeenTxid?: string,
  ): Promise<BitcoinTxInfo[]> {
    const suffix = lastSeenTxid ? `/txs/chain/${lastSeenTxid}` : "/txs";
    return this.get(`/address/${address}${suffix}`);
  }

  fetchTxInfo(txid: string): Promise<BitcoinTxStatus> {
    return this.get(`/tx/${txid}/status`);
  }

  async fetchFeeEstimates(blocks: number): Promise<number> {
    const estimates = await this.get<Record<string, number>>("/fee-estimates");
    const rate = estimates[String(blocks)];
    if (rate === undefined) {
      const available = Object.keys(estimates)
        .map(Number)
        .sort((a, b) => a - b);
      const closest = available.find((t) => t >= blocks) ?? available[available.length - 1];
      return closest !== undefined ? (estimates[String(closest)] ?? 2) : 2;
    }
    return rate;
  }

  fetchScriptInfo(hash: string): Promise<BitcoinScriptInfo> {
    return this.get(`/scripthash/${hash}`);
  }

  fetchScriptUTxOs(hash: string): Promise<BitcoinUTxO[]> {
    return this.get(`/scripthash/${hash}/utxo`);
  }

  fetchScriptTxs(
    hash: string,
    lastSeenTxid?: string,
  ): Promise<BitcoinTxInfo[]> {
    const suffix = lastSeenTxid ? `/txs/chain/${lastSeenTxid}` : "/txs";
    return this.get(`/scripthash/${hash}${suffix}`);
  }

  async submitTx(txHex: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/tx`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: txHex,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[BlockstreamBitcoinProvider] submitTx failed: ${body}`);
    }
    return res.text(); // Blockstream returns the txid as plain text
  }
}
