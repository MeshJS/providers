import {
  BitcoinAddressInfo,
  BitcoinScriptInfo,
  BitcoinTxInfo,
  BitcoinTxStatus,
  BitcoinUTxO,
} from "./types/bitcoin";

export type BlockstreamNetwork = "mainnet" | "testnet";

type EsploraHeaders = Record<string, string>;

type EsploraClientOptions = {
  name: string;
  baseUrl: string;
  getHeaders?: () => Promise<EsploraHeaders>;
  onUnauthorized?: () => void;
};

/**
 * Shared Esplora HTTP client. Not part of the public package surface.
 * Public providers implement `IBitcoinProvider`; this base only supplies the HTTP methods.
 */
export class EsploraBitcoinClient {
  private readonly name: string;
  private readonly baseUrl: string;
  private readonly getHeaders: () => Promise<EsploraHeaders>;
  private readonly onUnauthorized?: () => void;

  constructor({
    name,
    baseUrl,
    getHeaders,
    onUnauthorized,
  }: EsploraClientOptions) {
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getHeaders = getHeaders ?? (async () => ({}));
    this.onUnauthorized = onUnauthorized;
  }

  private async request(
    path: string,
    init?: RequestInit,
    allowRetry = true,
  ): Promise<Response> {
    const headers = {
      ...(await this.getHeaders()),
      ...Object.fromEntries(new Headers(init?.headers).entries()),
    };
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (res.status === 401 && allowRetry && this.onUnauthorized) {
      this.onUnauthorized();
      return this.request(path, init, false);
    }
    return res;
  }

  protected async get<T>(path: string): Promise<T> {
    const res = await this.request(path);
    if (!res.ok) {
      throw new Error(
        `[${this.name}] GET ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.json() as Promise<T>;
  }

  async fetchAddressInfo(address: string): Promise<BitcoinAddressInfo> {
    return this.get(`/address/${address}`);
  }

  async fetchAddressUTxOs(address: string): Promise<BitcoinUTxO[]> {
    return this.get(`/address/${address}/utxo`);
  }

  async fetchUTxO(txid: string, vout?: number): Promise<BitcoinUTxO[]> {
    const [tx, outspends] = await Promise.all([
      this.get<BitcoinTxInfo>(`/tx/${txid}`),
      this.get<{ spent: boolean }[]>(`/tx/${txid}/outspends`),
    ]);
    return tx.vout
      .map((out, index) => ({
        index,
        out,
        spent: outspends[index]?.spent ?? false,
      }))
      .filter(
        ({ index, spent }) => !spent && (vout === undefined || index === vout),
      )
      .map(({ index, out }) => ({
        txid,
        vout: index,
        value: out.value,
        status: tx.status,
      }));
  }

  async fetchAddressTxs(
    address: string,
    lastSeenTxid?: string,
  ): Promise<BitcoinTxInfo[]> {
    const suffix = lastSeenTxid ? `/txs/chain/${lastSeenTxid}` : "/txs";
    return this.get(`/address/${address}${suffix}`);
  }

  async fetchTxInfo(txid: string): Promise<BitcoinTxStatus> {
    return this.get(`/tx/${txid}/status`);
  }

  async fetchFeeEstimates(blocks: number): Promise<number> {
    const estimates = await this.get<Record<string, number>>("/fee-estimates");
    const rate = estimates[String(blocks)];
    if (rate === undefined) {
      const available = Object.keys(estimates)
        .map(Number)
        .sort((a, b) => a - b);
      const closest =
        available.find((t) => t >= blocks) ?? available[available.length - 1];
      return closest !== undefined ? (estimates[String(closest)] ?? 2) : 2;
    }
    return rate;
  }

  async fetchScriptInfo(hash: string): Promise<BitcoinScriptInfo> {
    return this.get(`/scripthash/${hash}`);
  }

  async fetchScriptUTxOs(hash: string): Promise<BitcoinUTxO[]> {
    return this.get(`/scripthash/${hash}/utxo`);
  }

  async fetchScriptTxs(
    hash: string,
    lastSeenTxid?: string,
  ): Promise<BitcoinTxInfo[]> {
    const suffix = lastSeenTxid ? `/txs/chain/${lastSeenTxid}` : "/txs";
    return this.get(`/scripthash/${hash}${suffix}`);
  }

  async submitTx(txHex: string): Promise<string> {
    const res = await this.request("/tx", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: txHex,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[${this.name}] submitTx failed: ${body}`);
    }
    return res.text();
  }
}
