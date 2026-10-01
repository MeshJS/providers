import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

import {
  AccountInfo,
  Action,
  Asset,
  AssetMetadata,
  BlockInfo,
  castProtocol,
  DEFAULT_FETCHER_OPTIONS,
  GovernanceProposalInfo,
  IEvaluator,
  IFetcher,
  IFetcherOptions,
  IListener,
  ISubmitter,
  LanguageVersion,
  NativeScript,
  PlutusScript,
  Protocol,
  RedeemerTagType,
  toBytes,
  TransactionInfo,
  UTxO,
} from "@meshsdk/common";
import {
  normalizePlutusScript,
  resolveRewardAddress,
  toScriptRef,
} from "@meshsdk/core-cst";

import { IagonInsightBudget, IagonInsightUTxO } from "./types";
import { parseAssetUnit, parseHttpError } from "./utils";

const PAGE = 100;

const TAGS: Record<string, RedeemerTagType> = {
  spend: "SPEND",
  mint: "MINT",
  publish: "CERT",
  withdraw: "REWARD",
  vote: "VOTE",
  propose: "PROPOSE",
};

const isNotFound = (error: unknown) =>
  axios.isAxiosError(error) && error.response?.status === 404;

/**
 * Iagon Insight is a Cardano mainnet API: https://insight.iagon.com
 *
 * Usage:
 * ```
 * import { IagonInsightProvider } from "@meshsdk/provider";
 *
 * const provider = new IagonInsightProvider("<your api key>");
 * ```
 */
export class IagonInsightProvider
  implements IFetcher, IListener, ISubmitter, IEvaluator
{
  private readonly _axiosInstance: AxiosInstance;
  // a script never changes under its hash, so it is fetched once per provider
  private readonly _scripts = new Map<string, Promise<string>>();

  /**
   * @param apiKey Your Iagon Insight API key, from the dashboard
   * @param baseUrl Defaults to https://mainnet.insight.iagon.com. The key only goes out over https.
   */
  constructor(apiKey: string, baseUrl = "https://mainnet.insight.iagon.com") {
    if (!apiKey) throw new Error("IagonInsightProvider needs an API key");
    const base = baseUrl.replace(/\/+$/, "");
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      throw new Error("IagonInsightProvider sends the API key only over https");
    }
    this._axiosInstance = axios.create({
      baseURL: base,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }

  async fetchAccountInfo(address: string): Promise<AccountInfo> {
    const reward = address.startsWith("addr")
      ? resolveRewardAddress(address)
      : address;
    try {
      const data = await this.request({ url: this.bf(`accounts/${reward}`) });
      return {
        poolId: data.pool_id,
        active: data.active || data.active_epoch !== null,
        balance: data.controlled_amount,
        rewards: data.withdrawable_amount,
        withdrawals: data.withdrawals_sum,
      };
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * UTxOs of an address, optionally only those holding an asset. A failed
   * request throws instead of answering with an empty list.
   */
  async fetchAddressUTxOs(address: string, asset?: string): Promise<UTxO[]> {
    try {
      const rows = await this.pages<IagonInsightUTxO>(
        `addresses/${address}/utxos${asset ? `/${asset}` : ""}`,
      );
      return await Promise.all(rows.map((u) => this.toUTxO(u, u.tx_hash)));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw parseHttpError(error);
    }
  }

  async fetchAddressTxs(
    address: string,
    options: IFetcherOptions = DEFAULT_FETCHER_OPTIONS,
  ): Promise<TransactionInfo[]> {
    const opts = { ...DEFAULT_FETCHER_OPTIONS, ...options };
    const txs: TransactionInfo[] = [];
    try {
      for (let page = 1; page <= (opts.maxPage ?? 1); page++) {
        const rows = await this.request({
          url: this.bf(`addresses/${address}/transactions`),
          params: { count: PAGE, page, order: opts.order },
        });
        for (const tx of rows) {
          const info = await this.fetchTxInfo(tx.tx_hash);
          txs.push({
            ...info,
            blockHeight: tx.block_height,
            blockTime: tx.block_time,
          } as TransactionInfo);
        }
        if (rows.length < PAGE) break;
      }
      return txs;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchAssetAddresses(
    asset: string,
  ): Promise<{ address: string; quantity: string }[]> {
    const { policyId, assetName } = parseAssetUnit(asset);
    try {
      return await this.pages(`assets/${policyId}${assetName}/addresses`);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw parseHttpError(error);
    }
  }

  async fetchAssetMetadata(asset: string): Promise<AssetMetadata> {
    const { policyId, assetName } = parseAssetUnit(asset);
    try {
      const data = await this.request({
        url: this.bf(`assets/${policyId}${assetName}`),
      });
      return <AssetMetadata>{
        ...data.onchain_metadata,
        fingerprint: data.fingerprint,
        totalSupply: data.quantity,
        mintingTxHash: data.initial_mint_tx_hash,
        mintCount: data.mint_or_burn_count,
      };
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchBlockInfo(hash: string): Promise<BlockInfo> {
    try {
      const data = await this.request({ url: this.bf(`blocks/${hash}`) });
      return {
        confirmations: data.confirmations,
        epoch: data.epoch,
        epochSlot: data.epoch_slot?.toString() ?? "",
        fees: data.fees,
        hash: data.hash,
        nextBlock: data.next_block ?? "",
        operationalCertificate: data.op_cert,
        output: data.output ?? "0",
        previousBlock: data.previous_block,
        size: data.size,
        slot: data.slot?.toString() ?? "",
        slotLeader: data.slot_leader ?? "",
        time: data.time,
        txCount: data.tx_count,
        VRFKey: data.block_vrf,
      };
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchCollectionAssets(
    policyId: string,
    cursor: number | string = 1,
  ): Promise<{ assets: Asset[]; next: number | null }> {
    try {
      const rows = await this.request({
        url: this.bf(`assets/policy/${policyId}`),
        params: { count: PAGE, page: cursor },
      });
      return {
        assets: rows.map((a: { asset: string; quantity: string }) => ({
          unit: a.asset,
          quantity: a.quantity,
        })),
        next: rows.length === PAGE ? Number(cursor) + 1 : null,
      };
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchProtocolParameters(epoch = Number.NaN): Promise<Protocol> {
    try {
      const data = await this.request({
        url: this.bf(`epochs/${isNaN(epoch) ? "latest" : epoch}/parameters`),
      });
      return castProtocol({
        coinsPerUtxoSize: data.coins_per_utxo_word,
        collateralPercent: data.collateral_percent,
        decentralisation: data.decentralisation_param,
        epoch: data.epoch,
        keyDeposit: data.key_deposit,
        maxBlockExMem: data.max_block_ex_mem,
        maxBlockExSteps: data.max_block_ex_steps,
        maxBlockHeaderSize: data.max_block_header_size,
        maxBlockSize: data.max_block_size,
        maxCollateralInputs: data.max_collateral_inputs,
        maxTxExMem: data.max_tx_ex_mem,
        maxTxExSteps: data.max_tx_ex_steps,
        maxTxSize: data.max_tx_size,
        maxValSize: data.max_val_size,
        minFeeA: data.min_fee_a,
        minFeeB: data.min_fee_b,
        minPoolCost: data.min_pool_cost,
        poolDeposit: data.pool_deposit,
        priceMem: data.price_mem,
        priceStep: data.price_step,
      });
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchCostModels(epoch?: number): Promise<number[][]> {
    let raw;
    try {
      const data = await this.request({
        url: this.bf(`epochs/${epoch ?? "latest"}/parameters`),
      });
      raw = data.cost_models_raw;
    } catch (error) {
      throw parseHttpError(error);
    }
    if (!raw?.PlutusV1 || !raw?.PlutusV2 || !raw?.PlutusV3) {
      throw new Error(`No cost models for epoch ${epoch ?? "latest"}`);
    }
    return [raw.PlutusV1, raw.PlutusV2, raw.PlutusV3];
  }

  async fetchTxInfo(hash: string): Promise<TransactionInfo> {
    try {
      const tx = await this.request({ url: this.bf(`txs/${hash}`) });
      const utxos = await this.request({ url: this.bf(`txs/${hash}/utxos`) });
      return <TransactionInfo>{
        block: tx.block,
        deposit: tx.deposit,
        fees: tx.fees,
        hash: tx.hash,
        index: tx.index,
        invalidAfter: tx.invalid_hereafter ?? "",
        invalidBefore: tx.invalid_before ?? "",
        slot: tx.slot?.toString() ?? "",
        size: tx.size,
        inputs: utxos.inputs,
        outputs: utxos.outputs,
      };
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchUTxOs(hash: string, index?: number): Promise<UTxO[]> {
    try {
      const data = await this.request({ url: this.bf(`txs/${hash}/utxos`) });
      // a collateral return is listed with the outputs, but only exists when
      // the scripts failed, and then it is the only output
      const outputs = (data.outputs as IagonInsightUTxO[]).filter(
        (o) =>
          !o.collateral && (index === undefined || o.output_index === index),
      );
      return await Promise.all(outputs.map((o) => this.toUTxO(o, hash)));
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchGovernanceProposal(
    txHash: string,
    certIndex: number,
  ): Promise<GovernanceProposalInfo> {
    try {
      const path = `governance/proposals/${txHash}/${certIndex}`;
      const data = await this.request({ url: this.bf(path) });
      let metadata;
      try {
        metadata = await this.request({ url: this.bf(`${path}/metadata`) });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return {
        txHash: data.tx_hash,
        certIndex: data.cert_index,
        governanceType: data.governance_type,
        deposit: data.deposit,
        returnAddress: data.return_address,
        governanceDescription: data.governance_description,
        ratifiedEpoch: data.ratified_epoch,
        enactedEpoch: data.enacted_epoch,
        droppedEpoch: data.dropped_epoch,
        expiredEpoch: data.expired_epoch,
        expiration: data.expiration,
        metadata,
      };
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * A generic GET. A path without a leading slash is the Blockfrost compatible
   * surface, `/v1/...` and `/koios/v1/...` work too.
   */
  async get(url: string): Promise<any> {
    try {
      return await this.request({
        url: url.startsWith("/") ? url : this.bf(url),
      });
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Submit a serialized transaction. Never sent twice: a submit that timed out
   * may well have reached the node.
   */
  async submitTx(tx: string): Promise<string> {
    try {
      return await this.request(
        {
          method: "POST",
          url: this.bf("tx/submit"),
          data: toBytes(tx),
          headers: { "Content-Type": "application/cbor" },
        },
        false,
      );
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Evaluates the scripts of a transaction on the Iagon Insight API, one at a
   * time per account. A 429 or 503 with a short Retry-After is asked again,
   * at most twice.
   */
  async evaluateTx(
    tx: string,
    additionalUtxos?: UTxO[],
    additionalTxs?: string[],
  ): Promise<Omit<Action, "data">[]> {
    let budgets: IagonInsightBudget[];
    try {
      const res = await this.request({
        method: "POST",
        url: "/v1/tx/evaluate",
        data: { tx, additionalUtxos, additionalTxs },
        headers: { "Content-Type": "application/json" },
      });
      budgets = res.data;
    } catch (error) {
      throw parseHttpError(error);
    }
    return budgets.map((b) => {
      const tag = TAGS[b.purpose];
      if (!tag) throw new Error(`Unknown redeemer purpose ${b.purpose}`);
      return { tag, index: b.index, budget: { mem: b.memory, steps: b.cpu } };
    });
  }

  onTxConfirmed(txHash: string, callback: () => void, limit = 100): void {
    let attempts = 0;

    const checkTx = setInterval(() => {
      if (attempts >= limit) {
        clearInterval(checkTx);
        return;
      }

      this.request({ url: this.bf(`txs/${txHash}`) })
        .then((tx) => this.request({ url: this.bf(`blocks/${tx.block}`) }))
        .then((block) => {
          if (block?.confirmations > 0) {
            clearInterval(checkTx);
            callback();
          }
        })
        .catch(() => {
          attempts += 1;
        });
    }, 5_000);
  }

  private bf(path: string): string {
    return `/api/v0/${path}`;
  }

  private async toUTxO(u: IagonInsightUTxO, txHash: string): Promise<UTxO> {
    return {
      input: { outputIndex: u.output_index, txHash },
      output: {
        address: u.address,
        amount: u.amount,
        dataHash: u.data_hash ?? undefined,
        plutusData: u.inline_datum ?? undefined,
        scriptRef: u.reference_script_hash
          ? await this.scriptRef(u.reference_script_hash)
          : undefined,
        scriptHash: u.reference_script_hash ?? undefined,
      },
    };
  }

  private scriptRef(hash: string): Promise<string> {
    let p = this._scripts.get(hash);
    if (!p) {
      p = this.loadScript(hash);
      this._scripts.set(hash, p);
      p.catch(() => this._scripts.delete(hash));
    }
    return p;
  }

  private async loadScript(hash: string): Promise<string> {
    const info = await this.request({ url: this.bf(`scripts/${hash}`) });
    let script: PlutusScript | NativeScript;
    if (info.type.startsWith("plutus")) {
      const { cbor } = await this.request({
        url: this.bf(`scripts/${hash}/cbor`),
      });
      script = {
        version: info.type.replace("plutus", "") as LanguageVersion,
        code: normalizePlutusScript(cbor, "DoubleCBOR"),
      };
    } else {
      const { json } = await this.request({
        url: this.bf(`scripts/${hash}/json`),
      });
      script = json as NativeScript;
    }
    return toScriptRef(script).toCbor().toString();
  }

  // a full page means there may be more, a short one is the last
  private async pages<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const rows: T[] = await this.request({
        url: this.bf(path),
        params: { count: PAGE, page },
      });
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  // 429 and 503 with a short Retry-After are a busy second, not an answer
  private async request(
    config: AxiosRequestConfig,
    retry = true,
  ): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await this._axiosInstance.request(config);
        return data;
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : 0;
        const wait = axios.isAxiosError(error)
          ? Number(error.response?.headers["retry-after"])
          : 0;
        if (
          retry &&
          attempt < 2 &&
          (status === 429 || status === 503) &&
          wait > 0 &&
          wait <= 5
        ) {
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        throw error;
      }
    }
  }
}
