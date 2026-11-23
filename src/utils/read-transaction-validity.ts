import { Serialization } from "@meshsdk/core-cst";

/** Read the explicit phase-2 flag in an Alonzo-or-later transaction. */
export function readTransactionValidity(cbor: unknown): boolean | undefined {
  if (typeof cbor !== "string" || !cbor) return undefined;
  try {
    const reader = new Serialization.CborReader(Serialization.TxCBOR(cbor));
    if (reader.readStartArray() !== 4) return undefined;
    reader.readEncodedValue(); // transaction body
    reader.readEncodedValue(); // witness set
    const validContract = reader.readBoolean();
    reader.readEncodedValue(); // auxiliary data
    reader.readEndArray();
    return validContract;
  } catch {
    return undefined;
  }
}
