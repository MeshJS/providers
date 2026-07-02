import { NexusProvider } from "@meshsdk/provider";

/**
 * Hermetic tests for NexusProvider evaluate / script resolution: the internal
 * axios instance is stubbed so the mapping logic runs without a live server.
 */
const makeProvider = (
  get: (url: string) => Promise<any>,
  post?: (url: string, body: any, config: any) => Promise<any>,
) => {
  const provider = new NexusProvider("https://nexus.test/api");
  (provider as any)._axiosInstance = {
    get: jest.fn(get),
    post: post ? jest.fn(post) : jest.fn(),
  };
  return provider;
};

describe("NexusProvider evaluator", () => {
  it("maps redeemer evaluation results to Mesh actions", async () => {
    const post = jest.fn(async (url: string, body: any) => {
      expect(url).toBe("transactions/evaluate");
      expect(body.cbor).toBe("aabbcc");
      return {
        status: 200,
        data: [
          {
            redeemerTag: "spend",
            index: 0,
            exUnits: { mem: 2000, steps: 500000 },
          },
          {
            redeemerTag: "publish",
            index: 1,
            exUnits: { mem: 1000, steps: 250000 },
          },
        ],
      };
    });
    const provider = makeProvider(async () => ({ status: 200 }), post);

    const res = await provider.evaluateTx("aabbcc");
    expect(res).toEqual([
      { tag: "SPEND", index: 0, budget: { mem: 2000, steps: 500000 } },
      { tag: "CERT", index: 1, budget: { mem: 1000, steps: 250000 } },
    ]);
  });

  it("surfaces evaluation errors (e.g. dormant 503 backend)", async () => {
    const post = jest.fn(async () => {
      throw {
        response: { status: 503, data: "evaluation backend not configured" },
      };
    });
    const provider = makeProvider(async () => ({ status: 200 }), post);

    const res = await provider.evaluateTx("aabbcc").catch(() => "error");
    expect(res).toBe("error");
  });

  it("resolves a native reference script by hash in tx UTxOs", async () => {
    // A trivial native script (RequireAllOf []) as its serialized bytes.
    const nativeScriptBytes =
      "8200581c00000000000000000000000000000000000000000000000000000000";
    const get = jest.fn(async (url: string) => {
      if (url.startsWith("transactions/")) {
        return {
          status: 200,
          data: {
            hash: "dd".repeat(32),
            outputs: [
              {
                tx_hash: "dd".repeat(32),
                output_index: 0,
                owner_addr: "addr_test1a",
                amounts: [{ unit: "lovelace", quantity: "1000000" }],
                reference_script_hash: "ee".repeat(28),
              },
            ],
          },
        };
      }
      // scripts/{hash}
      return {
        status: 200,
        data: {
          hash: "ee".repeat(28),
          type: "timelock",
          bytes: nativeScriptBytes,
        },
      };
    });
    const provider = makeProvider(get);

    const utxos = await provider.fetchUTxOs("dd".repeat(32));
    expect(utxos).toHaveLength(1);
    expect(utxos[0]!.output.scriptHash).toBe("ee".repeat(28));
    // A script ref CBOR string should have been resolved from the hash lookup.
    expect(typeof utxos[0]!.output.scriptRef).toBe("string");
    expect(utxos[0]!.output.scriptRef!.length).toBeGreaterThan(0);
  });
});
