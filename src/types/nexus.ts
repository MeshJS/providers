/**
 * Types describing the JSON shapes returned by the Nexus API
 * (https://nexus.gerowallet.io). Only the fields consumed by
 * {@link NexusProvider} are modelled here.
 *
 * Note: Nexus serialises most Cardano data DTOs in camelCase, but the
 * transaction-scoped UTxO endpoints (`/transactions/*`) use snake_case.
 * The two UTxO shapes below reflect that split.
 */

/** Inline datum (CIP-32) as returned on address UTxOs. */
export type NexusInlineDatum = {
  bytes: string;
  value?: unknown;
};

/** Reference script (CIP-33) as returned on address UTxOs. */
export type NexusReferenceScript = {
  hash: string;
  size?: number;
  /** e.g. "plutusV1" | "plutusV2" | "plutusV3" | "timelock" (native). */
  type: string;
  bytes: string;
  value?: unknown;
};

/** A single asset balance entry on an address UTxO. */
export type NexusAssetBalance = {
  /** "lovelace" for ADA, otherwise policyId + assetName (hex). */
  unit: string;
  policyId?: string;
  assetName?: string;
  fingerprint?: string;
  quantity: string;
  decimals?: number;
};

/** UTxO shape from `GET /addresses/{address}/utxos` (camelCase). */
export type NexusAddressUTxO = {
  txHash: string;
  txIndex: number;
  address: string;
  stakeAddress?: string;
  /** Lovelace amount. */
  value: string;
  datumHash?: string;
  inlineDatum?: NexusInlineDatum;
  referenceScript?: NexusReferenceScript;
  assets?: NexusAssetBalance[];
  blockHash?: string;
  blockHeight?: number;
  slot?: number;
};

/** A single amount entry on a transaction UTxO. */
export type NexusAmount = {
  /** "lovelace" for ADA, otherwise policyId + assetName (hex). */
  unit: string;
  quantity: string;
};

/** UTxO shape from `GET /transactions/{txHash}/utxos` (snake_case). */
export type NexusUTxO = {
  tx_hash: string;
  output_index: number;
  owner_addr: string;
  amounts?: NexusAmount[];
  lovelace_amount?: number;
  data_hash?: string;
  inline_datum?: string;
  reference_script_hash?: string;
  script_ref?: string;
};

/** One asset minted under a policy id, from `GET /policy/{policyId}/assets`. */
export type NexusPolicyAsset = {
  policyId: string;
  assetName: string;
  unit: string;
  fingerprint?: string;
  quantity: string;
};

/** Holder entry from `GET /assets/{unit}/holders`. */
export type NexusAssetHolder = {
  address: string;
  quantity: string;
};

/**
 * A single redeemer evaluation result from `POST /transactions/evaluate`.
 * `redeemerTag` follows the Ogmios purpose vocabulary
 * (spend | mint | publish/cert | withdraw/reward).
 */
export type NexusRedeemerEval = {
  redeemerTag: string;
  index: number;
  exUnits: {
    mem: number | string;
    steps: number | string;
  };
};

/** Script details from `GET /scripts/{scriptHash}`. */
export type NexusScript = {
  hash: string;
  /** e.g. "plutusV1" | "plutusV2" | "plutusV3" | "timelock" (native). */
  type: string;
  /** Raw script bytes in hex; some sources return it under `cbor`. */
  bytes?: string;
  cbor?: string;
  value?: unknown;
};
