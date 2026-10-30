/**
 * MeshDevnetProvider unit tests.
 *
 * These tests mock `fetch` globally — no real devnet server is required.
 * They verify:
 *   - Constructor flexibility (string URL, config object, defaults)
 *   - `fetchCostModels` returns the Conway default arrays (no network call)
 *   - `fetchProtocolParameters` parses the /params response correctly
 *   - `fetchAddressUTxOs` maps the /utxos response to Mesh UTxO shape
 *   - `fetchAddressTxs` maps the /address/:addr/txs response
 *   - `fetchBlockInfo` maps the /block/:hash response
 *   - `fetchTxInfo` maps the /tx/:hash response
 *   - `submitTx` POSTs to /tx/submit and returns txHash
 *   - `evaluateTx` POSTs to /evaluate and returns Action[] without `data`
 *   - `topup` POSTs to /topup/:address/:lovelace
 *   - `getTip` fetches /tip
 *   - `isHealthy` returns true on 200 /health, false on network error
 *   - `fetchGovernanceProposal` throws "not supported"
 *   - `fetchHandle` throws "not supported"
 *   - `fetchHandleAddress` throws "not supported"
 *   - `fetchAssetAddresses` returns []
 *   - `fetchCollectionAssets` returns { assets: [], next: null }
 *   - `fetchAccountInfo` returns empty account
 *   - `awaitTransactionConfirmation` resolves once the tx is confirmed
 */

import {
  MeshDevnetProvider,
  type DevnetWallet,
  type DevnetTip,
} from "@meshsdk/provider";
import {
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
} from "@meshsdk/common";

// ── fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  }) as any;
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – constructor", () => {
  it("accepts a plain URL string", () => {
    const p = new MeshDevnetProvider("http://localhost:4000");
    expect(p).toBeInstanceOf(MeshDevnetProvider);
  });

  it("accepts a config object", () => {
    const p = new MeshDevnetProvider({ baseUrl: "http://my-devnet:9999" });
    expect(p).toBeInstanceOf(MeshDevnetProvider);
  });

  it("defaults to http://localhost:4000 when no arg is given", () => {
    const p = new MeshDevnetProvider();
    expect(p).toBeInstanceOf(MeshDevnetProvider);
  });

  it("strips a trailing slash from the base URL", async () => {
    mockFetch([], 200);
    const p = new MeshDevnetProvider("http://localhost:4000/");
    await p.fetchAddressUTxOs("addr_test1...");
    const call = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(call).not.toContain("//utxos");
  });
});

// ── fetchCostModels ───────────────────────────────────────────────────────────

describe("MeshDevnetProvider – fetchCostModels", () => {
  it("returns three arrays (V1, V2, V3) without making a network call", async () => {
    // Spy so we can assert it was never invoked.
    const spy = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as any);
    const p = new MeshDevnetProvider();
    const cms = await p.fetchCostModels();
    expect(cms).toHaveLength(3);
    expect(cms[0]).toEqual(DEFAULT_V1_COST_MODEL_LIST);
    expect(cms[1]).toEqual(DEFAULT_V2_COST_MODEL_LIST);
    expect(cms[2]).toEqual(DEFAULT_V3_COST_MODEL_LIST);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── fetchProtocolParameters ───────────────────────────────────────────────────

describe("MeshDevnetProvider – fetchProtocolParameters", () => {
  it("maps /params to a Protocol object", async () => {
    mockFetch({
      coinsPerUtxoSize: 4310,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      minFeeA: 44,
      minFeeB: 155381,
      keyDeposit: 2000000,
      maxTxSize: 16384,
      maxValSize: 5000,
      poolDeposit: 500000000,
      maxCollateralInputs: 3,
      collateralPercent: 150,
      maxBlockSize: 65536,
      maxBlockHeaderSize: 1100,
      maxTxExMem: "14000000",
      maxTxExSteps: "10000000000",
    });
    const p = new MeshDevnetProvider();
    const params = await p.fetchProtocolParameters();
    expect(params.minFeeA).toBe(44);
    expect(params.minFeeB).toBe(155381);
    expect(params.coinsPerUtxoSize).toBe(4310);
    expect(typeof params.epoch).toBe("number");
  });
});

// ── fetchAddressUTxOs ─────────────────────────────────────────────────────────

describe("MeshDevnetProvider – fetchAddressUTxOs", () => {
  it("maps /utxos/:address to UTxO[]", async () => {
    mockFetch([
      {
        input: { txHash: "abc123", outputIndex: 0 },
        output: {
          address: "addr_test1...",
          amount: [{ unit: "lovelace", quantity: "5000000" }],
          dataHash: null,
          plutusData: null,
          scriptRef: null,
        },
      },
    ]);
    const p = new MeshDevnetProvider();
    const utxos = await p.fetchAddressUTxOs("addr_test1...");
    expect(utxos).toHaveLength(1);
    expect(utxos[0].input.txHash).toBe("abc123");
    expect(utxos[0].output.amount[0].quantity).toBe("5000000");
  });

  it("appends ?asset=<unit> when filtering by asset", async () => {
    mockFetch([]);
    const p = new MeshDevnetProvider();
    await p.fetchAddressUTxOs("addr_test1...", "lovelace");
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain("?asset=lovelace");
  });
});

// ── fetchAddressTxs ───────────────────────────────────────────────────────────

describe("MeshDevnetProvider – fetchAddressTxs", () => {
  it("maps /address/:addr/txs to TransactionInfo[]", async () => {
    mockFetch([
      {
        hash: "txhash1",
        block: "blockhash1",
        blockHeight: 10,
        blockTime: 1700000000,
        slot: 999,
        fees: "172761",
        deposit: "0",
        size: 300,
        inputs: [],
        outputs: [],
      },
    ]);
    const p = new MeshDevnetProvider();
    const txs = await p.fetchAddressTxs("addr_test1...");
    expect(txs).toHaveLength(1);
    expect(txs[0].hash).toBe("txhash1");
    expect(txs[0].fees).toBe("172761");
    expect(txs[0].slot).toBe("999");
  });
});

// ── fetchBlockInfo ────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – fetchBlockInfo", () => {
  it("maps /block/:hash to BlockInfo", async () => {
    mockFetch({
      hash: "blockhash1",
      height: 42,
      slot: 4200,
      epoch: 0,
      epochSlot: 200,
      time: 1700000000,
      txCount: 3,
      txHashes: ["a", "b", "c"],
      previousHash: "prevhash",
      bodyHash: "bodyhash",
      feesCollected: "500000",
    });
    const p = new MeshDevnetProvider();
    const block = await p.fetchBlockInfo("blockhash1");
    expect(block.hash).toBe("blockhash1");
    expect(block.txCount).toBe(3);
    expect(block.slot).toBe("4200");
  });
});

// ── fetchTxInfo ───────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – fetchTxInfo", () => {
  it("maps /tx/:hash to TransactionInfo", async () => {
    mockFetch({
      hash: "txhash1",
      block: "blockhash1",
      blockHeight: 5,
      blockTime: 1700000001,
      slot: 500,
      fees: "172000",
      fee: "172000",
      deposit: "0",
      size: 256,
      inputs: [],
      outputs: [],
    });
    const p = new MeshDevnetProvider();
    const tx = await p.fetchTxInfo("txhash1");
    expect(tx.hash).toBe("txhash1");
    expect(tx.fees).toBe("172000");
  });
});

// ── submitTx ──────────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – submitTx", () => {
  it("POSTs CBOR bytes to /tx/submit and returns txHash", async () => {
    mockFetch({ txHash: "submittedTxHash" });
    const p = new MeshDevnetProvider();
    const hash = await p.submitTx("deadbeef");
    expect(hash).toBe("submittedTxHash");
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toContain("/tx/submit");
    expect((call[1] as RequestInit).method).toBe("POST");
  });

  it("throws when the server returns an error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: () => Promise.resolve({ error: "invalid cbor" }),
    }) as any;
    const p = new MeshDevnetProvider();
    await expect(p.submitTx("badhex")).rejects.toThrow(/invalid cbor/);
  });
});

// ── evaluateTx ────────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – evaluateTx", () => {
  it("POSTs to /evaluate and returns ExUnit estimates", async () => {
    mockFetch([
      { tag: "SPEND", index: 0, budget: { mem: 500000, steps: 1000000 } },
    ]);
    const p = new MeshDevnetProvider();
    const results = await p.evaluateTx("cafebabe");
    expect(results).toHaveLength(1);
    expect(results[0].tag).toBe("SPEND");
    expect(results[0].budget.mem).toBe(500000);
  });
});

// ── topup ─────────────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – topup", () => {
  it("POSTs to /topup/:address/:lovelace and returns txHash", async () => {
    mockFetch({ txHash: "faucetTxHash", address: "addr_test1...", lovelace: "10000000" });
    const p = new MeshDevnetProvider();
    const hash = await p.topup("addr_test1...", 10_000_000);
    expect(hash).toBe("faucetTxHash");
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain("/topup/");
    expect(url).toContain("10000000");
  });
});

// ── getTip ────────────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – getTip", () => {
  it("fetches /tip and returns DevnetTip", async () => {
    const tip: DevnetTip = {
      slot: 1234,
      blockHeight: 10,
      blockHash: "hash1",
      epoch: 0,
      epochSlot: 34,
      networkMagic: 42,
      networkId: 0,
    };
    mockFetch(tip);
    const p = new MeshDevnetProvider();
    const result = await p.getTip();
    expect(result.slot).toBe(1234);
    expect(result.networkMagic).toBe(42);
  });
});

// ── isHealthy ─────────────────────────────────────────────────────────────────

describe("MeshDevnetProvider – isHealthy", () => {
  it("returns true when /health responds 200", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    const p = new MeshDevnetProvider();
    expect(await p.isHealthy()).toBe(true);
  });

  it("returns false when fetch throws (server not running)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;
    const p = new MeshDevnetProvider();
    expect(await p.isHealthy()).toBe(false);
  });
});

// ── Unsupported methods ───────────────────────────────────────────────────────

describe("MeshDevnetProvider – unsupported methods", () => {
  const p = new MeshDevnetProvider();

  it("fetchGovernanceProposal throws", async () => {
    await expect(p.fetchGovernanceProposal("abc", 0)).rejects.toThrow(
      /not supported by MeshDevnetProvider/,
    );
  });

  it("fetchHandle throws", async () => {
    await expect(p.fetchHandle("$handle")).rejects.toThrow(
      /not supported by MeshDevnetProvider/,
    );
  });

  it("fetchHandleAddress throws", async () => {
    await expect(p.fetchHandleAddress("$handle")).rejects.toThrow(
      /not supported by MeshDevnetProvider/,
    );
  });

  it("fetchAssetAddresses returns []", async () => {
    const result = await p.fetchAssetAddresses("abc123");
    expect(result).toEqual([]);
  });

  it("fetchCollectionAssets returns { assets: [], next: null }", async () => {
    const result = await p.fetchCollectionAssets("policy1");
    expect(result.assets).toEqual([]);
    expect(result.next).toBeNull();
  });

  it("fetchAccountInfo returns a zero-balance account", async () => {
    const info = await p.fetchAccountInfo("addr_test1...");
    expect(info.active).toBe(false);
    expect(info.balance).toBe("0");
  });

  it("fetchAssetMetadata returns minimal metadata", async () => {
    const meta = await p.fetchAssetMetadata("abc123");
    expect(meta).toHaveProperty("name");
  });
});

// ── awaitTransactionConfirmation ──────────────────────────────────────────────

describe("MeshDevnetProvider – awaitTransactionConfirmation", () => {
  it("resolves to true once the tx appears in a block", async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      // First call: tx not yet in a block; second call: confirmed
      const block = callCount >= 2 ? "someblockhash" : null;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ hash: "tx1", block }),
      });
    }) as any;

    jest.useFakeTimers();
    const p = new MeshDevnetProvider();
    const promise = p.awaitTransactionConfirmation("tx1", 10_000);

    // Advance two polling intervals
    jest.advanceTimersByTime(2_000);
    await Promise.resolve(); // flush microtasks

    jest.useRealTimers();
    await expect(promise).resolves.toBe(true);
  });
});
