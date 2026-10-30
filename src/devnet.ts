/**
 * MeshDevnetProvider — drop-in IFetcher + ISubmitter + IEvaluator + IListener
 * implementation that communicates with a running `mesh-devnet` HTTP server.
 *
 * Usage:
 * ```typescript
 * import { MeshDevnetProvider } from "@meshsdk/provider";
 *
 * const provider = new MeshDevnetProvider("http://localhost:4000");
 * const params   = await provider.fetchProtocolParameters();
 *
 * // Pass to MeshTxBuilder / MeshWallet exactly like BlockfrostProvider:
 * const builder  = new MeshTxBuilder({ fetcher: provider, submitter: provider, params });
 * const wallet   = new MeshWallet({ networkId: 0, fetcher: provider, submitter: provider, ... });
 * ```
 *
 * The devnet server is part of the `mesh-devnet` package
 * (`packages/mesh-devnet` in the MeshJS monorepo). Start it with:
 *
 *   npx mesh-devnet start --port 4000
 *
 * Extra devnet-only helpers (`getWallets`, `topup`, `getTip`, `getMempool`)
 * are available directly on the provider instance.
 */

import {
  Action,
  AccountInfo,
  Asset,
  AssetMetadata,
  BlockInfo,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
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

import { utxosToAssets } from "./common/utxos-to-assets";

// ── Public config type (re-exported so callers can type the constructor arg) ─

export interface MeshDevnetConfig {
  /**
   * Base URL of the running mesh-devnet server.
   * @default "http://localhost:4000"
   */
  baseUrl?: string;
}

// ── Devnet-specific response shapes ──────────────────────────────────────────

/** Genesis wallet returned by GET /wallets */
export interface DevnetWallet {
  index: number;
  address: string;
  paymentKeyHash: string;
  /** Raw 32-byte hex private key */
  privateKey: string;
  /** `5820…` prefixed — drop straight into `MeshWallet({ key: { type: "cli", payment: <here> } })` */
  privateKeyCli: string;
  publicKey: string;
  lovelace: string;
}

/** Chain-tip response from GET /tip */
export interface DevnetTip {
  slot: number;
  blockHeight: number;
  blockHash: string | null;
  epoch: number;
  epochSlot: number;
  networkMagic: number;
  networkId: number;
}

/** Mempool snapshot from GET /mempool */
export interface DevnetMempool {
  size: number;
  txs: Array<{ txHash: string; addedAt: number }>;
}

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * Provider that targets a running `mesh-devnet` in-process Cardano devnet.
 *
 * Implements all four MeshSDK provider interfaces:
 *   - `IFetcher`   — UTxOs, blocks, transactions, protocol parameters, …
 *   - `ISubmitter` — raw CBOR transaction submission
 *   - `IEvaluator` — ExUnit estimation via the devnet CEK evaluator
 *   - `IListener`  — transaction confirmation polling
 */
export class MeshDevnetProvider
  implements IFetcher, ISubmitter, IEvaluator, IListener
{
  private readonly base: string;

  /**
   * @param urlOrConfig  URL string **or** `MeshDevnetConfig` object.
   *                     Defaults to `http://localhost:4000`.
   */
  constructor(urlOrConfig: string | MeshDevnetConfig = "http://localhost:4000") {
    const url =
      typeof urlOrConfig === "string"
        ? urlOrConfig
        : (urlOrConfig.baseUrl ?? "http://localhost:4000");
    this.base = url.replace(/\/$/, "");
  }

  // ── ISubmitter ────────────────────────────────────────────────────────────

  /**
   * Submit a CBOR-hex-encoded transaction to the devnet.
   * Returns the transaction hash on success.
   */
  async submitTx(txHex: string): Promise<string> {
    const res = await fetch(`${this.base}/tx/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/cbor" },
      body: Buffer.from(txHex, "hex"),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `MeshDevnetProvider submitTx failed [${res.status}]: ${(body as any).error ?? res.statusText}`,
      );
    }
    const data = (await res.json()) as { txHash: string };
    return data.txHash;
  }

  // ── IFetcher ──────────────────────────────────────────────────────────────

  async fetchAddressUTxOs(address: string, asset?: string): Promise<UTxO[]> {
    const url = asset
      ? `${this.base}/utxos/${encodeURIComponent(address)}?asset=${asset}`
      : `${this.base}/utxos/${encodeURIComponent(address)}`;
    const data = await this._getJson<any[]>(url);
    return data.map(toMeshUTxO);
  }

  async fetchAddressAssets(
    address: string,
  ): Promise<{ [key: string]: string }> {
    const utxos = await this.fetchAddressUTxOs(address);
    return utxosToAssets(utxos);
  }

  async fetchAddressTxs(
    address: string,
    _options?: IFetcherOptions,
  ): Promise<TransactionInfo[]> {
    const data = await this._getJson<any[]>(
      `${this.base}/address/${encodeURIComponent(address)}/txs`,
    );
    return data.map(toMeshTxInfo);
  }

  async fetchProtocolParameters(_epoch?: number): Promise<Protocol> {
    const data = await this._getJson<any>(`${this.base}/params`);
    return toMeshProtocol(data);
  }

  /**
   * Fetches Plutus cost models.
   *
   * The mesh-devnet runs Conway-era protocol parameters; the `/params` endpoint
   * does not include cost models (they live inside the Plutus evaluator), so
   * this method returns the canonical Conway default cost models from
   * `@meshsdk/common` (`DEFAULT_V1_COST_MODEL_LIST`, `DEFAULT_V2_COST_MODEL_LIST`,
   * `DEFAULT_V3_COST_MODEL_LIST`).
   */
  async fetchCostModels(_epoch?: number): Promise<number[][]> {
    return [
      DEFAULT_V1_COST_MODEL_LIST,
      DEFAULT_V2_COST_MODEL_LIST,
      DEFAULT_V3_COST_MODEL_LIST,
    ];
  }

  async fetchBlockInfo(hash: string): Promise<BlockInfo> {
    const data = await this._getJson<any>(`${this.base}/block/${hash}`);
    return toMeshBlockInfo(data);
  }

  async fetchTxInfo(hash: string): Promise<TransactionInfo> {
    const data = await this._getJson<any>(`${this.base}/tx/${hash}`);
    return toMeshTxInfo(data);
  }

  /**
   * Resolves UTxOs by transaction hash (and optional output index).
   * `MeshTxBuilder` calls this to fill in inputs supplied as `{ txHash, index }`.
   */
  async fetchUTxOs(hash: string, index?: number): Promise<UTxO[]> {
    const data = await this._getJson<any>(`${this.base}/tx/${hash}/utxos`);
    const utxos: UTxO[] = ((data.outputs ?? []) as any[]).map((o: any) => ({
      input: { txHash: hash, outputIndex: o.outputIndex ?? o.index },
      output: {
        address: o.address,
        amount: o.amount as Asset[],
        dataHash: o.dataHash ?? undefined,
        plutusData: o.plutusData ?? undefined,
        scriptRef: o.scriptRef ?? undefined,
      },
    }));
    return index === undefined
      ? utxos
      : utxos.filter((u) => u.input.outputIndex === index);
  }

  async fetchAccountInfo(_address: string): Promise<AccountInfo> {
    // Stake-pool delegation is not implemented on the devnet — return a
    // minimal but type-correct account view.
    return { active: false, balance: "0", rewards: "0", withdrawals: "0" };
  }

  async fetchAssetAddresses(
    _asset: string,
  ): Promise<{ address: string; quantity: string }[]> {
    // The devnet does not maintain an inverted asset-to-address index.
    return [];
  }

  async fetchAssetMetadata(_asset: string): Promise<AssetMetadata> {
    // Asset metadata (CIP-25 / CIP-68) is not stored by the devnet.
    return { name: "", image: "" } as AssetMetadata;
  }

  async fetchCollectionAssets(
    _policyId: string,
    _cursor?: number | string,
  ): Promise<{ assets: Asset[]; next: string | number | null }> {
    // The devnet has no policy-scoped asset index.
    return { assets: [], next: null };
  }

  async fetchGovernanceProposal(
    _txHash: string,
    _certIndex: number,
  ): Promise<GovernanceProposalInfo> {
    throw new Error(
      "fetchGovernanceProposal is not supported by MeshDevnetProvider: governance proposals are not implemented in the mesh-devnet.",
    );
  }

  async fetchHandle(_handle: string): Promise<object> {
    throw new Error(
      "fetchHandle is not supported by MeshDevnetProvider: ADA Handles are mainnet-only NFTs and have no registry on the devnet.",
    );
  }

  async fetchHandleAddress(_handle: string): Promise<string> {
    throw new Error(
      "fetchHandleAddress is not supported by MeshDevnetProvider: ADA Handles are mainnet-only NFTs and have no registry on the devnet.",
    );
  }

  /** Generic HTTP GET pass-through — relative paths are resolved against the devnet base URL. */
  async get(url: string): Promise<any> {
    const target = url.startsWith("http")
      ? url
      : `${this.base}${url.startsWith("/") ? "" : "/"}${url}`;
    return this._getJson(target);
  }

  // ── IEvaluator ────────────────────────────────────────────────────────────

  /**
   * Evaluates a transaction and returns estimated ExUnits per redeemer.
   *
   * The devnet evaluates scripts with the actual CEK machine (the same
   * execution that would happen on-chain) and returns exact resource costs.
   *
   * @param tx              - CBOR-hex-encoded transaction
   * @param additionalUtxos - Extra UTxOs to include in the evaluation context
   */
  async evaluateTx(
    tx: string,
    additionalUtxos: UTxO[] = [],
    _additionalTxs: string[] = [],
  ): Promise<Omit<Action, "data">[]> {
    const res = await fetch(`${this.base}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cbor: tx, additionalUTxOs: additionalUtxos }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `MeshDevnetProvider evaluateTx failed [${res.status}]: ${(body as any).error ?? res.statusText}`,
      );
    }
    const data = (await res.json()) as Array<{
      tag: string;
      index: number;
      budget: { mem: number; steps: number };
    }>;
    return data.map((d) => ({
      tag: d.tag as any,
      index: d.index,
      budget: { mem: d.budget.mem, steps: d.budget.steps },
    }));
  }

  // ── IListener ─────────────────────────────────────────────────────────────

  /**
   * Polls `GET /tx/:hash` every second until the transaction appears in a block,
   * then invokes `callback`.
   *
   * @param txHash  - Transaction hash to wait for
   * @param callback - Called once the transaction is confirmed
   * @param limit   - Maximum number of polling attempts (default 100)
   */
  onTxConfirmed(txHash: string, callback: () => void, limit = 100): void {
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`${this.base}/tx/${txHash}`);
        if (res.ok) {
          const data = (await res.json()) as { block?: string | null };
          if (data.block) {
            clearInterval(poll);
            callback();
            return;
          }
        }
      } catch {
        /* network blip — keep polling */
      }
      if (attempts >= limit) {
        clearInterval(poll);
        throw new Error(
          `MeshDevnetProvider: transaction ${txHash} not confirmed after ${limit} polls`,
        );
      }
    }, 1_000);
  }

  /**
   * Promise-based alternative to `onTxConfirmed`.
   * Resolves when the transaction is confirmed; rejects after `timeoutMs`.
   *
   * @param txHash     - Transaction hash to wait for
   * @param timeoutMs  - Timeout in milliseconds (default 120 000)
   */
  awaitTransactionConfirmation(
    txHash: string,
    timeoutMs = 120_000,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(`Transaction ${txHash} not confirmed within ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.onTxConfirmed(
        txHash,
        () => {
          clearTimeout(deadline);
          resolve(true);
        },
        Math.ceil(timeoutMs / 1_000),
      );
    });
  }

  // ── Devnet-specific helpers ───────────────────────────────────────────────

  /**
   * Returns the list of pre-funded genesis wallets.
   * Each wallet includes:
   * - `address`       — bech32 payment address
   * - `privateKeyCli` — `5820…` prefixed key, ready for `MeshWallet({ key: { type: "cli", payment: … } })`
   * - `lovelace`      — initial balance (string)
   */
  async getWallets(): Promise<DevnetWallet[]> {
    return this._getJson(`${this.base}/wallets`);
  }

  /**
   * Faucet: credit any address with the given lovelace amount (devnet only).
   * The UTxO is created immediately in the ledger state — no block required.
   *
   * @returns The synthetic transaction hash for the faucet UTxO
   */
  async topup(
    address: string,
    lovelace: bigint | number | string,
  ): Promise<string> {
    const res = await fetch(
      `${this.base}/topup/${encodeURIComponent(address)}/${lovelace}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        `MeshDevnetProvider topup failed: ${(data as any).error}`,
      );
    return (data as any).txHash as string;
  }

  /** Returns the current chain tip, epoch, and network identity. */
  async getTip(): Promise<DevnetTip> {
    return this._getJson(`${this.base}/tip`);
  }

  /** Returns the current mempool contents. */
  async getMempool(): Promise<DevnetMempool> {
    return this._getJson(`${this.base}/mempool`);
  }

  /** Liveness probe — resolves to `true` when the server is reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async _getJson<T = unknown>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `MeshDevnetProvider GET ${url} [${res.status}]: ${(body as any).error ?? res.statusText}`,
      );
    }
    return res.json() as Promise<T>;
  }
}

// ── Wire-format → MeshSDK type converters ────────────────────────────────────

function toMeshUTxO(raw: any): UTxO {
  return {
    input: {
      txHash: raw.input.txHash,
      outputIndex: raw.input.outputIndex,
    },
    output: {
      address: raw.output.address,
      amount: raw.output.amount as Asset[],
      dataHash: raw.output.dataHash ?? undefined,
      plutusData: raw.output.plutusData ?? undefined,
      scriptRef: raw.output.scriptRef ?? undefined,
      scriptHash: raw.output.scriptHash ?? undefined,
    },
  };
}

function toMeshProtocol(raw: any): Protocol {
  return {
    epoch: Number(raw.epoch ?? 0),
    coinsPerUtxoSize: Number(raw.coinsPerUtxoSize ?? 4310),
    priceMem: Number(raw.priceMem ?? 0.0577),
    priceStep: Number(raw.priceStep ?? 0.0000721),
    minFeeA: Number(raw.minFeeA ?? 44),
    minFeeB: Number(raw.minFeeB ?? 155381),
    keyDeposit: Number(raw.keyDeposit ?? 2000000),
    maxTxSize: Number(raw.maxTxSize ?? 16384),
    maxValSize: Number(raw.maxValSize ?? 5000),
    poolDeposit: Number(raw.poolDeposit ?? 500000000),
    maxCollateralInputs: Number(raw.maxCollateralInputs ?? 3),
    decentralisation: Number(raw.decentralisation ?? 0),
    maxBlockSize: Number(raw.maxBlockSize ?? 65536),
    collateralPercent: Number(raw.collateralPercent ?? 150),
    maxBlockHeaderSize: Number(raw.maxBlockHeaderSize ?? 1100),
    minPoolCost: String(raw.minPoolCost ?? "340000000"),
    maxTxExMem: String(raw.maxTxExMem ?? "14000000"),
    maxTxExSteps: String(raw.maxTxExSteps ?? "10000000000"),
    maxBlockExMem: String(raw.maxBlockExMem ?? "80000000"),
    maxBlockExSteps: String(raw.maxBlockExSteps ?? "40000000000"),
    minFeeRefScriptCostPerByte: Number(raw.minFeeRefScriptCostPerByte ?? 15),
  };
}

function toMeshBlockInfo(raw: any): BlockInfo {
  return {
    confirmations: 0,
    epoch: Number(raw.epoch ?? 0),
    epochSlot: String(raw.epochSlot ?? 0),
    fees: String(raw.feesCollected ?? "0"),
    hash: raw.hash,
    nextBlock: raw.nextBlock ?? "",
    operationalCertificate: "",
    output: String(raw.output ?? "0"),
    previousBlock: raw.previousHash ?? "",
    size: Number(raw.size ?? 0),
    slot: String(raw.slot),
    slotLeader: raw.slotLeader ?? "devnet",
    time: Number(raw.time ?? 0),
    txCount: Number(raw.txCount ?? 0),
    VRFKey: "",
  };
}

function toMeshTxInfo(raw: any): TransactionInfo {
  const inputs: UTxO[] = ((raw.inputs ?? []) as any[]).map((i: any) => ({
    input: {
      txHash: i.txHash ?? i.input?.txHash,
      outputIndex:
        i.outputIndex ?? i.input?.outputIndex ?? i.index ?? 0,
    },
    output: i.output ?? { address: "", amount: [] as Asset[] },
  }));
  const outputs: UTxO[] = ((raw.outputs ?? []) as any[]).map(
    (o: any, i: number) => ({
      input: { txHash: raw.hash, outputIndex: o.index ?? i },
      output: {
        address: o.address,
        amount: o.amount as Asset[],
        dataHash: o.dataHash ?? undefined,
        plutusData: o.plutusData ?? undefined,
        scriptRef: o.scriptRef ?? undefined,
      },
    }),
  );
  return {
    block: raw.block ?? "",
    blockHeight: Number(raw.blockHeight ?? 0),
    blockTime: Number(raw.blockTime ?? 0),
    deposit: String(raw.deposit ?? "0"),
    fees: String(raw.fees ?? raw.fee ?? "0"),
    hash: raw.hash,
    index: Number(raw.index ?? 0),
    invalidAfter: String(raw.ttl ?? raw.invalidAfter ?? ""),
    invalidBefore: String(raw.validityStart ?? raw.invalidBefore ?? ""),
    slot: String(raw.slot),
    size: Number(raw.size ?? 0),
    inputs,
    outputs,
  };
}
