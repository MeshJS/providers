import { IagonInsightProvider } from "@meshsdk/provider";

// the axios instance is stubbed, no server needed
const makeProvider = (
  request: (config: any) => Promise<any>,
  baseUrl?: string,
) => {
  const provider = new IagonInsightProvider("key", baseUrl);
  (provider as any)._axiosInstance = { request: jest.fn(request) };
  return provider;
};

const axiosError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    response: { status, data: { status_code: status }, headers },
  });

const utxo = (i: number, extra: Record<string, unknown> = {}) => ({
  address: "addr1xyz",
  tx_hash: "aa".repeat(32),
  output_index: i,
  amount: [{ unit: "lovelace", quantity: "1000000" }],
  data_hash: null,
  inline_datum: null,
  reference_script_hash: null,
  ...extra,
});

describe("IagonInsightProvider fetcher", () => {
  it("only sends the key over https", () => {
    expect(
      () => new IagonInsightProvider("key", "http://insight.example"),
    ).toThrow(/only over https/);
    expect(
      () => new IagonInsightProvider("key", "http://localhost:8080"),
    ).not.toThrow();
  });

  it("pages until a page is not full", async () => {
    const provider = makeProvider(async (config) => ({
      data:
        config.params.page === 1
          ? Array.from({ length: 100 }, (_, i) => utxo(i))
          : [utxo(100, { inline_datum: "d87980" })],
    }));

    const utxos = await provider.fetchAddressUTxOs("addr1xyz");
    expect(utxos).toHaveLength(101);
    expect(utxos[100]!.output.plutusData).toBe("d87980");
    expect((provider as any)._axiosInstance.request).toHaveBeenCalledTimes(2);
    expect((provider as any)._axiosInstance.request.mock.calls[0][0].url).toBe(
      "/api/v0/addresses/addr1xyz/utxos",
    );
  });

  it("is an empty list for an asset the address does not hold", async () => {
    const provider = makeProvider(async () => {
      throw axiosError(404);
    });
    expect(
      await provider.fetchAddressUTxOs("addr1xyz", "ab".repeat(28)),
    ).toEqual([]);
  });

  it("throws on a failed request instead of an empty wallet", async () => {
    const provider = makeProvider(async () => {
      throw axiosError(402);
    });
    await expect(provider.fetchAddressUTxOs("addr1xyz")).rejects.toMatch(
      /"status":402/,
    );
  });

  it("fetches a reference script once for many outputs", async () => {
    const hash = "cd".repeat(28);
    const provider = makeProvider(async (config) => {
      if (config.url.endsWith(`/scripts/${hash}`))
        return { data: { type: "timelock" } };
      if (config.url.endsWith(`/scripts/${hash}/json`))
        return { data: { json: { type: "sig", keyHash: "ef".repeat(28) } } };
      return {
        data: [
          utxo(0, { reference_script_hash: hash }),
          utxo(1, { reference_script_hash: hash }),
        ],
      };
    });

    const utxos = await provider.fetchAddressUTxOs("addr1xyz");
    expect(utxos[0]!.output.scriptRef).toBeDefined();
    expect(utxos[0]!.output.scriptRef).toBe(utxos[1]!.output.scriptRef);
    const scriptCalls = (
      provider as any
    )._axiosInstance.request.mock.calls.filter((c: any) =>
      c[0].url.includes("/scripts/"),
    );
    expect(scriptCalls).toHaveLength(2);
  });

  it("maps a block", async () => {
    const provider = makeProvider(async () => ({
      data: {
        confirmations: 3,
        epoch: 611,
        epoch_slot: 12,
        hash: "b7".repeat(32),
        slot: 34,
        tx_count: 5,
      },
    }));

    const block = await provider.fetchBlockInfo("b7".repeat(32));
    expect(block.epoch).toBe(611);
    expect(block.slot).toBe("34");
    expect(block.nextBlock).toBe("");
  });

  it("takes an epoch boundary block without slot, height or epoch", async () => {
    const provider = makeProvider(async () => ({
      data: {
        hash: "5f".repeat(32),
        height: null,
        slot: null,
        epoch: null,
        epoch_slot: null,
        slot_leader: "Genesis slot leader",
        tx_count: 0,
        confirmations: 1,
      },
    }));

    const block = await provider.fetchBlockInfo("5f".repeat(32));
    expect(block.slot).toBe("");
    expect(block.epochSlot).toBe("");
  });

  it("does not hand out the collateral return of a valid transaction", async () => {
    const provider = makeProvider(async () => ({
      data: {
        inputs: [],
        outputs: [utxo(0), utxo(1), { ...utxo(2), collateral: true }],
      },
    }));

    const utxos = await provider.fetchUTxOs("aa".repeat(32));
    expect(utxos.map((u) => u.input.outputIndex)).toEqual([0, 1]);
  });
});
