import { Asset } from "@meshsdk/common";

/** An output as the Iagon Insight API serves it on its Blockfrost compatible surface. */
export type IagonInsightUTxO = {
  address: string;
  collateral?: boolean;
  tx_hash: string;
  output_index: number;
  amount: Asset[];
  data_hash: string | null;
  inline_datum: string | null;
  reference_script_hash: string | null;
};

/** One redeemer budget from `POST /v1/tx/evaluate`. */
export type IagonInsightBudget = {
  index: number;
  purpose: string;
  memory: number;
  cpu: number;
};
