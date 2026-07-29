import axios, { AxiosInstance } from "axios";

import {
  AccountInfo,
  Action,
  Asset,
  AssetMetadata,
  BlockInfo,
  castProtocol,
  DEFAULT_FETCHER_OPTIONS,
  fromUTF8,
  GovernanceProposalInfo,
  IEvaluator,
  IFetcher,
  IFetcherOptions,
  IListener,
  ISubmitter,
  PlutusScript,
  Protocol,
  RedeemerTagType,
  SUPPORTED_HANDLES,
  TransactionInfo,
  UTxO,
} from "@meshsdk/common";
import {
  deserializeNativeScript,
  fromNativeScript,
  normalizePlutusScript,
  resolveRewardAddress,
  toScriptRef,
} from "@meshsdk/core-cst";

import { utxosToAssets } from "./common/utxos-to-assets";
import {
  NexusAddressUTxO,
  NexusReferenceScript,
  NexusRedeemerEval,
  NexusScript,
  NexusUTxO,
} from "./types";
import { getAdditionalUtxos, parseAssetUnit, parseHttpError } from "./utils";

export type NexusSupportedNetworks = "mainnet" | "preprod" | "preview";

const DEFAULT_NEXUS_URL = "https://nexus.gerowallet.io/api";
const DEFAULT_PAGE_SIZE = 100;

/**
 * Nexus is Gero's Cardano data API (https://nexus.gerowallet.io). It exposes
 * a Blockfrost/Koios-style REST surface for querying chain data and submitting
 * transactions.
 *
 * Usage:
 * ```
 * import { NexusProvider } from "@meshsdk/provider";
 *
 * // hosted instance, API key is network-scoped
 * const provider = new NexusProvider('<Your-API-Key>');
 *
 * // self-hosted instance (include the `/api` path segment)
 * const provider = new NexusProvider('https://my-nexus.example.com/api');
 * ```
 */
export class NexusProvider
  implements IFetcher, IListener, ISubmitter, IEvaluator
{
  private readonly _axiosInstance: AxiosInstance;
  private readonly _network: NexusSupportedNetworks;

  /**
   * If you are using a privately hosted Nexus instance, pass its base URL
   * (including the `/api` path). Optionally pass an API key and the network the
   * instance serves.
   * @param baseUrl The base URL of the instance, e.g. `https://host/api`.
   * @param apiKey Optional API key sent as the `X-Api-Key` header.
   * @param network Optional network the instance serves. Default is `mainnet`.
   */
  constructor(
    baseUrl: string,
    apiKey?: string,
    network?: NexusSupportedNetworks,
  );

  /**
   * If you are using the hosted Nexus instance, pass your API key. The key is
   * network-scoped, so the network is derived from the key server-side.
   * @param apiKey Your Nexus API key.
   * @param network Optional network hint used for handle resolution. Default `mainnet`.
   */
  constructor(apiKey: string, network?: NexusSupportedNetworks);

  constructor(...args: unknown[]) {
    const first = args[0] as string;
    const isUrl =
      typeof first === "string" &&
      (first.startsWith("http") || first.startsWith("/"));

    if (isUrl) {
      const apiKey = typeof args[1] === "string" ? args[1] : undefined;
      this._network = (args[2] as NexusSupportedNetworks) ?? "mainnet";
      this._axiosInstance = axios.create({
        baseURL: first,
        headers: apiKey ? { "X-Api-Key": apiKey } : undefined,
      });
    } else {
      const apiKey = first;
      this._network = (args[1] as NexusSupportedNetworks) ?? "mainnet";
      this._axiosInstance = axios.create({
        baseURL: DEFAULT_NEXUS_URL,
        headers: { "X-Api-Key": apiKey },
      });
    }
  }

  /**
   * Evaluates the resources required to execute the transaction.
   * Requires the Nexus instance to have an evaluation backend configured
   * (Ogmios); otherwise the endpoint responds 503.
   * @param cbor - The transaction in CBOR hex to evaluate
   * @param additionalUtxos - Additional UTxOs referenced by the transaction but not yet on-chain
   * @param additionalTxs - Additional (chained) transactions whose outputs the tx spends
   */
  async evaluateTx(
    cbor: string,
    additionalUtxos?: UTxO[],
    additionalTxs?: string[],
  ): Promise<Omit<Action, "data">[]> {
    const additionalUtxoSet = getAdditionalUtxos(
      "ogmios",
      additionalUtxos,
      additionalTxs,
    );

    try {
      const headers = { "Content-Type": "application/json" };
      const { status, data } = await this._axiosInstance.post(
        "transactions/evaluate",
        { cbor, additionalUtxoSet },
        { headers },
      );

      if ((status === 200 || status === 202) && Array.isArray(data)) {
        const tagMap: { [key: string]: RedeemerTagType } = {
          spend: "SPEND",
          mint: "MINT",
          cert: "CERT",
          certificate: "CERT",
          publish: "CERT",
          reward: "REWARD",
          withdraw: "REWARD",
          withdrawal: "REWARD",
          vote: "VOTE",
          voting: "VOTE",
          propose: "PROPOSE",
          proposing: "PROPOSE",
        };

        return data.map((redeemer: NexusRedeemerEval) => {
          const tag = tagMap[redeemer.redeemerTag.toLowerCase()];
          if (!tag) {
            // Throw a string, not an Error: the surrounding catch runs it through
            // parseHttpError, which JSON.stringifies (an Error would become "{}").
            throw `Unknown redeemer tag from Nexus: ${redeemer.redeemerTag}`;
          }
          return <Omit<Action, "data">>{
            tag,
            index: Number(redeemer.index),
            budget: {
              mem: Number(redeemer.exUnits.mem),
              steps: Number(redeemer.exUnits.steps),
            },
          };
        });
      }

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Obtain information about a specific stake account.
   * @param address - Wallet address (or stake address) to fetch account information
   */
  async fetchAccountInfo(address: string): Promise<AccountInfo> {
    const rewardAddress = address.startsWith("addr")
      ? resolveRewardAddress(address)
      : address;

    try {
      const { data, status } = await this._axiosInstance.get(
        `account/${rewardAddress}/info`,
      );

      if (status === 200 || status === 202)
        return <AccountInfo>{
          poolId: data.poolId,
          active: data.active ?? data.activeEpoch != null,
          balance: data.controlledAmount,
          rewards: data.withdrawableAmount,
          withdrawals: data.withdrawalsSum,
        };

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Fetches the assets for a given address.
   * @param address - The address to fetch assets for
   * @returns A map of asset unit to quantity
   */
  async fetchAddressAssets(
    address: string,
  ): Promise<{ [key: string]: string }> {
    const utxos = await this.fetchAddressUTxOs(address);
    return utxosToAssets(utxos);
  }

  /**
   * Transactions for an address.
   * @param address
   * @param option - Fetcher options (pagination)
   * @returns - partial TransactionInfo
   */
  async fetchAddressTxs(
    address: string,
    option: IFetcherOptions = DEFAULT_FETCHER_OPTIONS,
  ): Promise<TransactionInfo[]> {
    const txs: TransactionInfo[] = [];
    try {
      const fetcherOptions = { ...DEFAULT_FETCHER_OPTIONS, ...option };

      for (let page = 1; page <= fetcherOptions.maxPage!; page++) {
        const { data, status } = await this._axiosInstance.get(
          `addresses/transactions/${address}?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`,
        );
        if (status !== 200 && status !== 202) throw parseHttpError(data);
        if (!data || data.length === 0) break;

        for (const tx of data) {
          txs.push(<TransactionInfo>{
            hash: tx.txHash,
            index: tx.txIndex ?? 0,
            block: "",
            slot: tx.slot?.toString() ?? "",
            fees: "",
            size: 0,
            deposit: "",
            invalidBefore: "",
            invalidAfter: "",
          });
        }
      }
      return txs;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * UTXOs of the address.
   * @param address - The address to fetch UTXOs for
   * @param asset - UTXOs of a given asset (policyId + assetName hex)
   * @returns - Array of UTxOs
   */
  async fetchAddressUTxOs(address: string, asset?: string): Promise<UTxO[]> {
    const filter = asset !== undefined ? `/${asset}` : "";
    const url = `addresses/${address}/utxos${filter}`;

    // Iterative pagination: a full page means "there may be more", a short (or
    // empty) page is the last one. MAX_PAGES bounds a backend that ignores
    // pagination and keeps returning full pages, so this can never loop forever.
    const MAX_PAGES = 10_000;
    const utxos: UTxO[] = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data, status } = await this._axiosInstance.get(
          `${url}?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`,
        );
        if (status !== 200 && status !== 202) throw parseHttpError(data);
        if (!data || data.length === 0) break;
        for (const utxo of data as NexusAddressUTxO[]) {
          utxos.push(this.toUTxO(utxo));
        }
        if (data.length < DEFAULT_PAGE_SIZE) break;
      }
      return utxos;
    } catch (error) {
      return [];
    }
  }

  /**
   * Fetches the asset addresses (holders) for a given asset.
   * @param asset - The asset to fetch addresses for
   */
  async fetchAssetAddresses(
    asset: string,
  ): Promise<{ address: string; quantity: string }[]> {
    const { policyId, assetName } = parseAssetUnit(asset);
    const unit = `${policyId}${assetName}`;

    const paginateAddresses = async (
      page = 1,
      addresses: { address: string; quantity: string }[] = [],
    ): Promise<{ address: string; quantity: string }[]> => {
      const { data, status } = await this._axiosInstance.get(
        `assets/${unit}/holders?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`,
      );

      if (status === 200 || status === 202)
        return data.length > 0
          ? paginateAddresses(page + 1, [
              ...addresses,
              ...data.map((holder: { address: string; quantity: string }) => ({
                address: holder.address,
                quantity: holder.quantity,
              })),
            ])
          : addresses;

      throw parseHttpError(data);
    };

    try {
      return await paginateAddresses();
    } catch (error) {
      return [];
    }
  }

  /**
   * Fetches the metadata for a given asset.
   * @param asset - The asset to fetch metadata for
   * @returns The metadata for the asset
   */
  async fetchAssetMetadata(asset: string): Promise<AssetMetadata> {
    try {
      const { policyId, assetName } = parseAssetUnit(asset);
      const { data, status } = await this._axiosInstance.get(
        `assets/detailedInfo?assetPolicy=${policyId}&assetName=${assetName}`,
      );

      if (status === 200 || status === 202) {
        const onchainMetadata =
          typeof data.onchainMetadata === "string" && data.onchainMetadata
            ? JSON.parse(data.onchainMetadata)
            : (data.onchainMetadata ?? {});

        return <AssetMetadata>{
          ...onchainMetadata,
          fingerprint: data.fingerprint,
          totalSupply: data.quantity,
          mintingTxHash: data.initialMintTxHash,
          mintCount: data.mintOrBurnCount,
        };
      }

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Fetches the latest block.
   * @returns The latest block information
   */
  async fetchLatestBlock(): Promise<BlockInfo> {
    try {
      const { data, status } = await this._axiosInstance.get(`blocks/latest`);

      if (status === 200 || status === 202) return this.toBlockInfo(data);

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchBlockInfo(hash: string): Promise<BlockInfo> {
    try {
      const { data, status } = await this._axiosInstance.get(`blocks/${hash}`);

      if (status === 200 || status === 202) return this.toBlockInfo(data);

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchCollectionAssets(
    policyId: string,
    cursor = 1,
  ): Promise<{ assets: Asset[]; next: string | number | null }> {
    try {
      const { data, status } = await this._axiosInstance.get(
        `policy/${policyId}/assets?page=${cursor}&pageSize=${DEFAULT_PAGE_SIZE}`,
      );

      if (status === 200 || status === 202)
        return {
          assets: data.map((asset: { unit: string; quantity: string }) => ({
            unit: asset.unit,
            quantity: asset.quantity,
          })),
          next: data.length === DEFAULT_PAGE_SIZE ? Number(cursor) + 1 : null,
        };

      throw parseHttpError(data);
    } catch (error) {
      return { assets: [], next: null };
    }
  }

  async fetchHandle(handle: string): Promise<AssetMetadata> {
    if (this._network !== "mainnet") {
      throw new Error(
        "Does not support fetching addresses by handle on non-mainnet networks.",
      );
    }
    try {
      const assetName = fromUTF8(handle.replace("$", ""));
      return await this.fetchAssetMetadata(
        `${SUPPORTED_HANDLES[1]}000de140${assetName}`,
      );
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchHandleAddress(handle: string): Promise<string> {
    if (this._network !== "mainnet") {
      throw new Error(
        "Does not support fetching addresses by handle on non-mainnet networks.",
      );
    }
    try {
      const assetName = fromUTF8(handle.replace("$", ""));
      const addresses = await this.fetchAssetAddresses(
        `${SUPPORTED_HANDLES[1]}${assetName}`,
      );
      return addresses[0]!.address;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchCostModels(epoch?: number): Promise<number[][]> {
    try {
      const url =
        epoch !== undefined && !isNaN(epoch)
          ? `epoch/params?epoch_no=${epoch}`
          : `epoch/latest/parameters`;
      const { data, status } = await this._axiosInstance.get(url);

      if (status === 200 || status === 202) {
        const costModels = data.costModels ?? {};
        return [costModels.PlutusV1, costModels.PlutusV2, costModels.PlutusV3]
          .filter((model) => model != null)
          .map((model) =>
            Object.values(model as Record<string, number>).map(Number),
          );
      }

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchProtocolParameters(epoch = Number.NaN): Promise<Protocol> {
    try {
      const paramsUrl = isNaN(epoch)
        ? `epoch/latest/parameters`
        : `epoch/params?epoch_no=${epoch}`;
      const { data, status } = await this._axiosInstance.get(paramsUrl);

      if (status === 200 || status === 202) {
        let epochNo = epoch;
        if (isNaN(epochNo)) {
          try {
            const latest = await this._axiosInstance.get(`epoch/latest`);
            epochNo = latest.data?.epoch;
          } catch (error) {
            // epoch number is best-effort; castProtocol falls back to default
          }
        }

        return castProtocol({
          epoch: epochNo,
          minFeeA: data.minFeeA,
          minFeeB: data.minFeeB,
          maxBlockSize: data.maxBlockSize,
          maxTxSize: data.maxTxSize,
          maxBlockHeaderSize: data.maxBlockHeaderSize,
          keyDeposit: data.keyDeposit,
          poolDeposit: data.poolDeposit,
          decentralisation: data.decentralisationParam,
          minPoolCost: data.minPoolCost,
          priceMem: data.priceMem,
          priceStep: data.priceStep,
          maxTxExMem: data.maxTxExMem,
          maxTxExSteps: data.maxTxExSteps,
          maxBlockExMem: data.maxBlockExMem,
          maxBlockExSteps: data.maxBlockExSteps,
          maxValSize: data.maxValSize,
          collateralPercent: data.collateralPercent,
          maxCollateralInputs: data.maxCollateralInputs,
          coinsPerUtxoSize: data.coinsPerUtxoSize,
          minFeeRefScriptCostPerByte: data.minFeeRefScriptCostPerByte,
        });
      }

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchTxInfo(hash: string): Promise<TransactionInfo> {
    try {
      const { data, status } = await this._axiosInstance.get(
        `transactions/${hash}`,
      );

      if (status === 200 || status === 202)
        return <TransactionInfo>{
          block: data.block_hash,
          deposit: data.deposit ?? "",
          fees: data.fee ?? "",
          hash: data.txHash,
          index: 0,
          invalidAfter: data.invalid_after?.toString() ?? "",
          invalidBefore: data.invalid_before?.toString() ?? "",
          slot: data.absolute_slot?.toString() ?? "",
          size: data.txSize ?? 0,
        };

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchUTxOs(hash: string, index?: number): Promise<UTxO[]> {
    try {
      const { data, status } = await this._axiosInstance.get(
        `transactions/${hash}/utxos`,
      );

      if (status === 200 || status === 202) {
        const outputs: UTxO[] = await Promise.all(
          (data.outputs ?? []).map((utxo: NexusUTxO) =>
            this.txUtxoToUTxO(utxo),
          ),
        );

        if (index !== undefined) {
          return outputs.filter((utxo) => utxo.input.outputIndex === index);
        }

        return outputs;
      }

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchGovernanceProposal(
    txHash: string,
    certIndex: number,
  ): Promise<GovernanceProposalInfo> {
    try {
      const govActionId = `${txHash}%23${certIndex}`;
      const { data, status } = await this._axiosInstance.get(
        `governance/proposals/${govActionId}`,
      );

      if (status === 200 || status === 202)
        return <GovernanceProposalInfo>{
          txHash: data.txHash,
          certIndex: data.index,
          governanceType: data.type,
          deposit: Number(data.deposit),
          returnAddress: data.returnAddress,
          governanceDescription: data.anchorUrl ?? "",
          ratifiedEpoch: 0,
          enactedEpoch: 0,
          droppedEpoch: 0,
          expiredEpoch: 0,
          expiration: 0,
          metadata: data.rawMetadata ?? data.govAction ?? {},
        };

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * A generic method to fetch data from a URL.
   * @param url - The URL to fetch data from
   * @returns - The data fetched from the URL
   */
  async get(url: string): Promise<any> {
    try {
      const { data, status } = await this._axiosInstance.get(url);
      if (status === 200 || status === 202) {
        return data;
      }
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * A generic method to post data to a URL.
   * @param url - The URL to post data to
   * @param body - Payload
   * @param headers - Specify headers, default: { "Content-Type": "application/json" }
   * @returns - Data
   */
  async post(
    url: string,
    body: any,
    headers = { "Content-Type": "application/json" },
  ): Promise<any> {
    try {
      const { data, status } = await this._axiosInstance.post(url, body, {
        headers,
      });

      if (status === 200 || status === 202) return data;

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Allow you to listen to a transaction confirmation. Upon confirmation, the callback will be called.
   * @param txHash - The transaction hash to listen for confirmation
   * @param callback - The callback function to call when the transaction is confirmed
   * @param limit - The number of attempts to make before giving up
   */
  onTxConfirmed(txHash: string, callback: () => void, limit = 100): void {
    let attempts = 0;

    const checkTx = setInterval(() => {
      if (attempts >= limit) {
        clearInterval(checkTx);
        return;
      }

      this.fetchTxInfo(txHash)
        .then((txInfo) => {
          this.fetchBlockInfo(txInfo.block)
            .then((blockInfo) => {
              if (blockInfo?.confirmations > 0) {
                clearInterval(checkTx);
                callback();
              }
            })
            .catch(() => {
              attempts += 1;
            });
        })
        .catch(() => {
          attempts += 1;
        });
    }, 5_000);
  }

  /**
   * Submit a serialized transaction to the network.
   * @param tx - The serialized transaction in hex to submit
   * @returns The transaction hash of the submitted transaction
   */
  async submitTx(tx: string): Promise<string> {
    try {
      const headers = { "Content-Type": "text/plain" };
      const { data, status } = await this._axiosInstance.post(
        `transactions/submit`,
        tx,
        { headers },
      );

      // Nexus returns the tx hash as a text/plain body that may be quoted or
      // whitespace-padded; normalize to a bare hash.
      if (status === 200 || status === 202)
        return typeof data === "string"
          ? data.trim().replace(/^"|"$/g, "")
          : data;

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  private toBlockInfo(data: any): BlockInfo {
    return <BlockInfo>{
      confirmations: data.confirmations,
      epoch: data.epoch,
      epochSlot: data.epoch_slot?.toString() ?? "",
      fees: data.fees ?? "",
      hash: data.hash,
      nextBlock: data.next_block ?? "",
      operationalCertificate: data.op_cert ?? "",
      output: data.output ?? "0",
      previousBlock: data.previous_block ?? "",
      size: data.size,
      slot: data.slot?.toString() ?? "",
      slotLeader: data.slot_leader ?? "",
      time: data.time,
      txCount: data.tx_count,
      VRFKey: data.block_vrf ?? "",
    };
  }

  private toUTxO = (utxo: NexusAddressUTxO): UTxO => ({
    input: {
      outputIndex: utxo.txIndex,
      txHash: utxo.txHash,
    },
    output: {
      address: utxo.address,
      amount: [
        { unit: "lovelace", quantity: utxo.value },
        ...(utxo.assets ?? []).map(
          (asset) =>
            <Asset>{
              unit: asset.unit,
              quantity: asset.quantity,
            },
        ),
      ],
      dataHash: utxo.datumHash ?? undefined,
      plutusData: utxo.inlineDatum?.bytes ?? undefined,
      scriptRef: this.resolveScriptRef(utxo.referenceScript),
      scriptHash: utxo.referenceScript?.hash ?? undefined,
    },
  });

  private txUtxoToUTxO = async (utxo: NexusUTxO): Promise<UTxO> => ({
    input: {
      outputIndex: utxo.output_index,
      txHash: utxo.tx_hash,
    },
    output: {
      address: utxo.owner_addr,
      // The transaction UTxO `amounts` already include the lovelace entry.
      amount: (utxo.amounts ?? []).map(
        (asset) =>
          <Asset>{
            unit: asset.unit,
            quantity: asset.quantity,
          },
      ),
      dataHash: utxo.data_hash ?? undefined,
      plutusData: utxo.inline_datum ?? undefined,
      // `script_ref` carries language-tagged CBOR (`82 0X <script>`); unwrap it to
      // a normalized Mesh scriptRef rather than passing the tagged bytes through.
      // When only the hash is present, resolve the script via /scripts/{hash}.
      scriptRef: utxo.script_ref
        ? this.unwrapScriptRef(utxo.script_ref)
        : await this.resolveScriptRefByHash(utxo.reference_script_hash),
      scriptHash: utxo.reference_script_hash ?? undefined,
    },
  });

  /**
   * Fetches a script by its hash.
   * @param scriptHash - The hash of the script to fetch
   * @returns The script (type + bytes), or undefined if not found
   */
  async fetchScriptByHash(
    scriptHash: string,
  ): Promise<NexusScript | undefined> {
    try {
      const { data, status } = await this._axiosInstance.get(
        `scripts/${scriptHash}`,
      );
      if (status === 200 || status === 202) return data as NexusScript;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  private resolveScriptRef = (
    referenceScript: NexusReferenceScript | undefined,
  ): string | undefined => {
    if (referenceScript && referenceScript.bytes) {
      return this.scriptRefFromParts(
        referenceScript.type,
        referenceScript.bytes,
      );
    }
    return undefined;
  };

  private resolveScriptRefByHash = async (
    scriptHash?: string,
  ): Promise<string | undefined> => {
    if (!scriptHash) return undefined;
    try {
      const { data, status } = await this._axiosInstance.get(
        `scripts/${scriptHash}`,
      );
      if (status === 200 || status === 202) {
        const script = data as NexusScript;
        const bytes = script.bytes ?? script.cbor;
        if (bytes) return this.scriptRefFromParts(script.type, bytes);
      }
    } catch (error) {
      // Best-effort: a script-resolution failure must not break UTxO fetching.
    }
    return undefined;
  };

  // Reference-script CBOR is language-tagged (`82 0X <script>`): 00 → native,
  // 01/02/03 → Plutus V1/V2/V3. The tag selects the script type and is stripped.
  private static readonly SCRIPT_REF_LANGUAGE_TAGS: Record<string, string> = {
    "8200": "native",
    "8201": "plutusV1",
    "8202": "plutusV2",
    "8203": "plutusV3",
  };

  private unwrapScriptRef = (scriptRefCbor: string): string | undefined => {
    const tag =
      NexusProvider.SCRIPT_REF_LANGUAGE_TAGS[
        scriptRefCbor.slice(0, 4).toLowerCase()
      ];
    if (tag) return this.scriptRefFromParts(tag, scriptRefCbor.slice(4));
    // No recognized language prefix: treat the whole value as a Plutus V2 body.
    return this.scriptRefFromParts("plutusV2", scriptRefCbor);
  };

  private scriptRefFromParts = (
    type: string,
    bytes: string,
  ): string | undefined => {
    // Nexus types are lowercase-`plutus` by convention, but match case-insensitively.
    const kind = type.toLowerCase();
    let script;
    if (kind.startsWith("plutus")) {
      const normalized = normalizePlutusScript(bytes, "DoubleCBOR");
      script = <PlutusScript>{
        code: normalized,
        version: `V${kind.match(/\d/)?.[0] ?? ""}`,
      };
    } else {
      script = fromNativeScript(deserializeNativeScript(bytes));
    }

    if (script) return toScriptRef(script).toCbor().toString();
    return undefined;
  };
}
