import { NexusProvider } from "@meshsdk/provider";

/**
 * Hermetic tests for NexusProvider: the internal axios instance is stubbed so
 * the response-mapping logic is exercised without a live Nexus server.
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

describe("NexusProvider fetcher", () => {
  it("maps address UTxOs (camelCase) including lovelace and assets", async () => {
    let page = 0;
    const provider = makeProvider(async () => {
      page += 1;
      if (page > 1) return { status: 200, data: [] };
      return {
        status: 200,
        data: [
          {
            txHash: "aa".repeat(32),
            txIndex: 1,
            address: "addr_test1xyz",
            value: "2000000",
            datumHash: "bb".repeat(32),
            inlineDatum: { bytes: "d87980" },
            assets: [{ unit: "cccc0011", quantity: "5" }],
          },
        ],
      };
    });

    const utxos = await provider.fetchAddressUTxOs("addr_test1xyz");
    expect(utxos).toHaveLength(1);
    expect(utxos[0]!.input).toEqual({
      txHash: "aa".repeat(32),
      outputIndex: 1,
    });
    expect(utxos[0]!.output.amount).toEqual([
      { unit: "lovelace", quantity: "2000000" },
      { unit: "cccc0011", quantity: "5" },
    ]);
    expect(utxos[0]!.output.dataHash).toBe("bb".repeat(32));
    expect(utxos[0]!.output.plutusData).toBe("d87980");
  });

  it("maps account info", async () => {
    const provider = makeProvider(async (url: string) => {
      expect(url).toContain("account/");
      return {
        status: 200,
        data: {
          poolId: "pool1abc",
          active: true,
          controlledAmount: "10000000",
          withdrawableAmount: "1000",
          withdrawalsSum: "500",
        },
      };
    });

    const info = await provider.fetchAccountInfo("stake_test1xyz");
    expect(info).toEqual({
      poolId: "pool1abc",
      active: true,
      balance: "10000000",
      rewards: "1000",
      withdrawals: "500",
    });
  });

  it("maps transaction UTxOs (snake_case) filtered by index", async () => {
    const provider = makeProvider(async () => ({
      status: 200,
      data: {
        hash: "dd".repeat(32),
        outputs: [
          {
            tx_hash: "dd".repeat(32),
            output_index: 0,
            owner_addr: "addr_test1a",
            amounts: [{ unit: "lovelace", quantity: "1000000" }],
          },
          {
            tx_hash: "dd".repeat(32),
            output_index: 1,
            owner_addr: "addr_test1b",
            amounts: [{ unit: "lovelace", quantity: "2000000" }],
          },
        ],
      },
    }));

    const utxos = await provider.fetchUTxOs("dd".repeat(32), 1);
    expect(utxos).toHaveLength(1);
    expect(utxos[0]!.input.outputIndex).toBe(1);
    expect(utxos[0]!.output.address).toBe("addr_test1b");
  });

  it("submits a transaction as text/plain and returns the hash", async () => {
    const post = jest.fn(async (_url: string, _body: any, config: any) => {
      expect(config.headers["Content-Type"]).toBe("text/plain");
      return { status: 200, data: "ee".repeat(32) };
    });
    const provider = makeProvider(
      async () => ({ status: 200, data: {} }),
      post,
    );

    const hash = await provider.submitTx("00ff");
    expect(hash).toBe("ee".repeat(32));
    expect(post).toHaveBeenCalledWith(
      "transactions/submit",
      "00ff",
      expect.anything(),
    );
  });

  it("normalizes a quoted / whitespace-padded submit response to a bare hash", async () => {
    const post = jest.fn(async () => ({
      status: 200,
      data: `  "${"ee".repeat(32)}"\n`,
    }));
    const provider = makeProvider(
      async () => ({ status: 200, data: {} }),
      post,
    );

    const hash = await provider.submitTx("00ff");
    expect(hash).toBe("ee".repeat(32));
  });
});

describe("NexusProvider fetchCostModels", () => {
  // Distinct values per language and index, so any misplaced value shows.
  const inLedgerOrder = (length: number, base: number) =>
    Array.from({ length }, (_, i) => base + i);
  const V1 = inLedgerOrder(166, 1_000);
  const V2 = inLedgerOrder(175, 2_000);
  const V3 = inLedgerOrder(350, 3_000);

  /** A keyed cost model as Nexus serves it in `costModels`. */
  const keyed = (values: number[], width: number) =>
    Object.fromEntries(
      values.map((value, i) => [String(i).padStart(width, "0"), value]),
    );

  it("prefers the ordered costModelsRaw arrays", async () => {
    const provider = makeProvider(async (url: string) => {
      expect(url).toBe("epoch/latest/parameters");
      return {
        status: 200,
        data: {
          // Different values, so a read of this map instead would show.
          costModels: {
            PlutusV1: keyed(inLedgerOrder(166, 9_000), 3),
            PlutusV2: keyed(inLedgerOrder(175, 9_000), 3),
            PlutusV3: keyed(inLedgerOrder(350, 9_000), 3),
          },
          costModelsRaw: { PlutusV1: V1, PlutusV2: V2, PlutusV3: V3 },
        },
      };
    });

    expect(await provider.fetchCostModels()).toEqual([V1, V2, V3]);
  });

  it("reads a specific epoch from epoch/params", async () => {
    const provider = makeProvider(async (url: string) => {
      expect(url).toBe("epoch/params?epoch_no=575");
      return {
        status: 200,
        data: { costModelsRaw: { PlutusV1: V1, PlutusV2: V2, PlutusV3: V3 } },
      };
    });

    expect(await provider.fetchCostModels(575)).toEqual([V1, V2, V3]);
  });

  it('orders zero-padded "000".."349" keys by position when costModelsRaw is absent', async () => {
    const costModels = {
      PlutusV1: keyed(V1, 3),
      PlutusV2: keyed(V2, 3),
      PlutusV3: keyed(V3, 3),
    };
    // The fixture reproduces the 2026-10-08 failure: JavaScript iterates
    // "100".."349" before "000".."099", so insertion order is gone.
    expect(Object.values(costModels.PlutusV3)).not.toEqual(V3);

    const provider = makeProvider(async () => ({
      status: 200,
      data: { costModels },
    }));

    expect(await provider.fetchCostModels()).toEqual([V1, V2, V3]);
  });

  it('orders plain "0".."n-1" keys when costModelsRaw is absent', async () => {
    const provider = makeProvider(async () => ({
      status: 200,
      data: {
        costModels: {
          PlutusV1: keyed(V1, 0),
          PlutusV2: keyed(V2, 0),
          PlutusV3: keyed(V3, 0),
        },
      },
    }));

    expect(await provider.fetchCostModels()).toEqual([V1, V2, V3]);
  });

  it("throws rather than guess an order when the keys are not 0..n-1", async () => {
    const { "042": _dropped, ...withGap } = keyed(V3, 3);
    const provider = makeProvider(async () => ({
      status: 200,
      data: {
        costModels: {
          PlutusV1: keyed(V1, 3),
          PlutusV2: keyed(V2, 3),
          PlutusV3: withGap,
        },
      },
    }));

    await expect(provider.fetchCostModels()).rejects.toThrow(
      /costModels\.PlutusV3 key .* ledger order is unknown/,
    );
  });

  it("keeps each language in its position when one is missing", async () => {
    const provider = makeProvider(async () => ({
      status: 200,
      data: { costModelsRaw: { PlutusV1: V1, PlutusV3: V3 } },
    }));

    // Mesh reads [V1, V2, V3] by position: V3 must not slide into V2's slot.
    expect(await provider.fetchCostModels()).toEqual([V1]);
  });
});
