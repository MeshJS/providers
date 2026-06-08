import {
  BitcoinAddressInfo,
  BitcoinScriptInfo,
  BitcoinTxInfo,
  BitcoinTxStatus,
  BitcoinUTxO,
  IBitcoinProvider,
} from "./types/bitcoin";

export type MaestroBitcoinNetwork = "mainnet" | "testnet";

interface MaestroBitcoinConfig {
  apiKey: string;
  network: MaestroBitcoinNetwork;
}

const BASE_URLS: Record<MaestroBitcoinNetwork, string> = {
  mainnet: "https://xbt-mainnet.gomaestro-api.org/v0/esplora",
  testnet: "https://xbt-testnet.gomaestro-api.org/v0/esplora",
};

/**
 * Bitcoin provider backed by the Maestro Esplora-compatible API.
 * Requires a Maestro API key (https://docs.gomaestro.org/).
 * Implements `IBitcoinProvider` (structurally compatible with
 * `IBitcoinProvider` from `@meshsdk/wallet`).
 *
 * @example
 * ```ts
 * import { MaestroBitcoinProvider } from "@meshsdk/provider";
 * import { BitcoinHeadlessWallet } from "@meshsdk/wallet";
 *
 * const provider = new MaestroBitcoinProvider({
 *   apiKey: "your-maestro-api-key",
 *   network: "mainnet",
 * });
 * const wallet = await BitcoinHeadlessWallet.fromMnemonic({
 *   network: "Mainnet",
 *   mnemonic: [...],
 *   provider,
 * });
 * ```
 */
export class MaestroBitcoinProvider implements IBitcoinProvider {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor({ apiKey, network}: MaestroBitcoinConfig) {
    this.baseUrl = BASE_URLS[network];
    this.headers = { "api-key": apiKey };
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), { headers: this.headers });
    if (!res.ok) {
      throw new Error(
        `[MaestroBitcoinProvider] GET ${path} failed: ${res.status} ${res.statusText}`,
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
    // Maestro uses `after_txid` as the pagination query param (Esplora-compatible).
    return this.get(
      `/address/${address}/txs`,
      lastSeenTxid ? { after_txid: lastSeenTxid } : undefined,
    );
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
    return this.get(
      `/scripthash/${hash}/txs`,
      lastSeenTxid ? { after_txid: lastSeenTxid } : undefined,
    );
  }

  async submitTx(txHex: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/tx`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "text/plain" },
      body: txHex,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[MaestroBitcoinProvider] submitTx failed: ${body}`);
    }
    return res.text(); // returns txid as plain text
  }
}
