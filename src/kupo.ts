import axios, { AxiosInstance } from "axios";

import {
  AccountInfo,
  Asset,
  AssetMetadata,
  BlockInfo,
  GovernanceProposalInfo,
  IFetcher,
  IFetcherOptions,
  Protocol,
  TransactionInfo,
  UTxO,
} from "@meshsdk/common";

import { parseHttpError } from "./utils";

// Unfortunately, Kupo is specifically used for fetching UTxOs and does not implement all methods of the IFetcher interface.
// Kupo is a specialized service for indexing Transaction outputs (UTxOs) and does not provide all the
// necessary methods for a full IFetcher implementation.
export class KupoProvider implements IFetcher {
  baseUrl: string;
  private readonly _axiosInstance: AxiosInstance;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this._axiosInstance = axios.create({
      baseURL: this.baseUrl,
    });
  }
  /**
   * Not available via Kupo.
   * Kupo is a UTxO chain indexer — it has no stake-account data.
   * Use a companion HTTP provider (Koios, Blockfrost, etc.) to fetch account info.
   */
  fetchAccountInfo(_address: string): Promise<AccountInfo> {
    throw new Error(
      "fetchAccountInfo is not supported by KupoProvider: Kupo only indexes UTxOs and has no stake-account endpoint.",
    );
  }
  async fetchAddressUTxOs(address: string, asset?: string): Promise<UTxO[]> {
    const { status, data } = await this.get(`${address}?unspent`);
    if (status === 200) {
      return data
        .map((utxo: any) => {
          const meshValue: Asset[] = this.kupoValueToMeshValue(utxo.value);
          if (asset) {
            if (!meshValue.some((v) => v.unit === asset)) {
              return null; // Skip UTxO if it does not contain the specified asset
            }
          }
          return {
            input: {
              txHash: utxo.transaction_id,
              outputIndex: utxo.output_index,
            },
            output: {
              address: utxo.address,
              amount: this.kupoValueToMeshValue(utxo.value),
            },
          };
        })
        .filter((utxo: any) => utxo !== null) as UTxO[];
    } else {
      parseHttpError(data);
    }
    return [];
  }
  /**
   * Derives a de-duplicated list of transactions for an address from Kupo matches.
   *
   * Kupo exposes all UTxOs (spent + unspent) for an address via `/matches/{address}`.
   * Each match carries the creating transaction hash and slot, so we can derive partial
   * `TransactionInfo` objects without a dedicated transaction-history endpoint.
   *
   * Note: only `hash`, `slot`, and `block` are populated; fee, size, validity range,
   * etc. are unavailable from Kupo alone.
   *
   * @param address - The Cardano address to query
   * @param _options - Ignored (Kupo returns all matches in one response)
   */
  async fetchAddressTxs(
    address: string,
    _options?: IFetcherOptions,
  ): Promise<TransactionInfo[]> {
    // No ?unspent filter — include both spent and unspent UTxOs to cover full tx history.
    const { status, data } = await this.get(address);
    if (status !== 200) {
      parseHttpError(data);
      return [];
    }

    // De-duplicate by transaction_id using a Map to keep first occurrence metadata.
    const seen = new Map<string, TransactionInfo>();
    for (const match of data as any[]) {
      const txHash: string = match.transaction_id;
      if (!seen.has(txHash)) {
        seen.set(txHash, <TransactionInfo>{
          hash: txHash,
          index: 0,
          block: match.created_at?.header_hash ?? "",
          slot: String(match.created_at?.slot_no ?? ""),
          fees: "",
          size: 0,
          deposit: "",
          invalidBefore: "",
          invalidAfter: "",
        });
      }
    }

    return Array.from(seen.values());
  }
  /**
   * Returns holders of an asset by querying Kupo's `/matches/{policyId}.{assetName}?unspent`.
   * Quantities are aggregated per address across all unspent UTxOs.
   *
   * @param asset - The asset unit: `{policyId}{assetName}` (no separator)
   */
  async fetchAssetAddresses(
    asset: string,
  ): Promise<{ address: string; quantity: string }[]> {
    // Kupo separates policyId and assetName with a dot; policyId is exactly 56 hex chars.
    const policyId = asset.slice(0, 56);
    const assetName = asset.slice(56); // may be empty
    const pattern = assetName ? `${policyId}.${assetName}` : `${policyId}.*`;

    const { status, data } = await this.get(`${pattern}?unspent`);
    if (status !== 200) {
      parseHttpError(data);
      return [];
    }

    const aggregated = new Map<string, bigint>();
    for (const match of data as any[]) {
      const addr: string = match.address;
      const assets: Record<string, number> = match.value?.assets ?? {};
      // Kupo asset key format: "{policyId}.{assetName}"
      const kupoKey = assetName ? `${policyId}.${assetName}` : undefined;
      let qty = BigInt(0);
      for (const [key, amount] of Object.entries(assets)) {
        if (!kupoKey || key === kupoKey) {
          qty += BigInt(amount as number);
        }
      }
      if (qty > 0n) {
        aggregated.set(addr, (aggregated.get(addr) ?? 0n) + qty);
      }
    }

    return Array.from(aggregated.entries()).map(([address, qty]) => ({
      address,
      quantity: qty.toString(),
    }));
  }
  /**
   * Not available via Kupo.
   * Kupo stores raw UTxO data only — it does not parse or expose CIP-25 / CIP-68 metadata.
   * Use a companion HTTP provider (Koios, Blockfrost, etc.) to fetch asset metadata.
   */
  fetchAssetMetadata(_asset: string): Promise<AssetMetadata> {
    throw new Error(
      "fetchAssetMetadata is not supported by KupoProvider: Kupo indexes UTxOs and does not expose asset metadata. Use a companion HTTP provider such as Koios or Blockfrost.",
    );
  }
  /**
   * Not available via Kupo.
   * Kupo stores UTxO lifecycle data only — it does not expose block-level metadata.
   * Use a companion HTTP provider (Koios, Blockfrost, etc.) to fetch block information.
   */
  fetchBlockInfo(_hash: string): Promise<BlockInfo> {
    throw new Error(
      "fetchBlockInfo is not supported by KupoProvider: Kupo only indexes UTxOs and does not expose block metadata. Use a companion HTTP provider such as Koios or Blockfrost.",
    );
  }
  /**
   * Returns all unspent assets for a given policy by querying `/matches/{policyId}.*?unspent`.
   * Quantities are aggregated per asset unit across all unspent UTxOs.
   *
   * Note: Kupo does not support cursor-based pagination for this pattern, so `next` is
   * always `null` and all results are returned in a single call.
   *
   * @param policyId - The policy ID (56 hex chars)
   * @param _cursor - Ignored (Kupo returns all matches in one response)
   */
  async fetchCollectionAssets(
    policyId: string,
    _cursor?: number | string,
  ): Promise<{ assets: Asset[]; next?: string | number | null }> {
    const { status, data } = await this.get(`${policyId}.*?unspent`);
    if (status !== 200) {
      parseHttpError(data);
      return { assets: [], next: null };
    }

    // Aggregate quantities by asset unit across all UTxOs.
    const aggregated = new Map<string, bigint>();
    for (const match of data as any[]) {
      const assets: Record<string, number> = match.value?.assets ?? {};
      for (const [kupoKey, amount] of Object.entries(assets)) {
        // Kupo key: "{policyId}.{assetName}" — convert to unit format (no dot).
        const [pol, assetName = ""] = kupoKey.split(".");
        if (pol !== policyId) continue;
        const unit = pol + assetName;
        aggregated.set(unit, (aggregated.get(unit) ?? 0n) + BigInt(amount as number));
      }
    }

    const assets: Asset[] = Array.from(aggregated.entries()).map(
      ([unit, qty]) => ({ unit, quantity: qty.toString() }),
    );

    return { assets, next: null };
  }
  /**
   * Not available via Kupo.
   * Kupo has no protocol-parameter endpoint. Use a companion HTTP provider (Koios,
   * Blockfrost, etc.) to fetch protocol parameters.
   */
  fetchProtocolParameters(_epoch?: number): Promise<Protocol> {
    throw new Error(
      "fetchProtocolParameters is not supported by KupoProvider: Kupo only indexes UTxOs. Use a companion HTTP provider such as Koios or Blockfrost.",
    );
  }

  /**
   * Not available via Kupo.
   * Kupo has no protocol-parameter endpoint — it cannot return Plutus cost models.
   * Use a companion HTTP provider (Koios, Blockfrost, etc.) to fetch cost models.
   */
  fetchCostModels(_epoch?: number): Promise<number[][]> {
    throw new Error(
      "fetchCostModels is not supported by KupoProvider: Kupo only indexes UTxOs. Use a companion HTTP provider such as Koios or Blockfrost.",
    );
  }

  /**
   * Not available via Kupo.
   * Kupo stores UTxO data only — it does not expose transaction-level metadata
   * (fees, validity range, block position, etc.).
   * Use a companion HTTP provider (Koios, Blockfrost, etc.) to fetch transaction info.
   */
  fetchTxInfo(_hash: string): Promise<TransactionInfo> {
    throw new Error(
      "fetchTxInfo is not supported by KupoProvider: Kupo only indexes UTxOs and does not store transaction-level metadata. Use a companion HTTP provider such as Koios or Blockfrost.",
    );
  }
  async fetchUTxOs(hash: string, index?: number): Promise<UTxO[]> {
    const { status, data } = await this.get(
      index === undefined ? `*@${hash}` : `${index}@${hash}`,
    );
    if (status === 200) {
      return data.map((utxo: any) => {
        return {
          input: {
            txHash: utxo.transaction_id,
            outputIndex: utxo.output_index,
          },
          output: {
            address: utxo.address,
            amount: this.kupoValueToMeshValue(utxo.value),
          },
        };
      }) as UTxO[];
    } else {
      parseHttpError(data);
    }
    return [];
  }
  /**
   * Not available via Kupo.
   * Governance proposals are chain-level state not tracked by Kupo's UTxO indexer.
   * Use a companion HTTP provider (Koios, Blockfrost, etc.) to fetch governance proposals.
   */
  fetchGovernanceProposal(
    _txHash: string,
    _certIndex: number,
  ): Promise<GovernanceProposalInfo> {
    throw new Error(
      "fetchGovernanceProposal is not supported by KupoProvider: Kupo only indexes UTxOs. Use a companion HTTP provider such as Koios or Blockfrost.",
    );
  }
  get(pattern: string): Promise<any> {
    try {
      return this._axiosInstance.get(`matches/${pattern}`);
    } catch (error) {
      throw new Error(`Failed to fetch data from Kupo: ${error}`);
    }
  }

  private kupoValueToMeshValue(value: any): any {
    if (value === null || value === undefined) return value;
    let meshValue: Asset[] = [];
    meshValue.push({
      unit: "lovelace",
      quantity: String(value.coins),
    });
    for (const [assetClass, quantity] of Object.entries(value.assets)) {
      let [policyId, assetName] = assetClass.split(".");
      if (!policyId) {
        throw new Error("Invalid asset class format found");
      }
      if (!assetName) {
        assetName = "";
      }
      meshValue.push({
        unit: policyId + assetName,
        quantity: String(quantity),
      });
    }
    return meshValue;
  }
}
