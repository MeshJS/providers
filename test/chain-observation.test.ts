import {
  IagonInsightProvider,
  KoiosProvider,
  MeshDevnetProvider,
  NexusProvider,
  YaciProvider,
} from "@meshsdk/provider";

const hash = "a1".repeat(32);
const blockHash = "b2".repeat(32);
const height = 0;
const slot = 42;

describe("chain observation", () => {
  it("reads the Koios tip and maps ledger validity from tx_info", async () => {
    const provider = new KoiosProvider("https://koios.test");
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: [{ hash: blockHash }],
    });
    const post = jest.fn().mockImplementation(async (path: string) => ({
      status: 200,
      data:
        path === "block_info"
          ? [
              {
                hash: blockHash,
                block_height: height,
                abs_slot: slot,
                epoch_slot: 2,
              },
            ]
          : [
              {
                tx_hash: hash,
                block_hash: blockHash,
                block_height: height,
                absolute_slot: slot,
                valid_contract: false,
              },
            ],
    }));
    Object.assign(provider, { _axiosInstance: { get, post } });

    await expect(provider.fetchLatestBlock()).resolves.toMatchObject({
      hash: blockHash,
      height,
      slot: String(slot),
    });
    expect(get).toHaveBeenCalledWith("tip");
    expect(post).toHaveBeenCalledWith("block_info", {
      _block_hashes: [blockHash],
    });
    await expect(provider.fetchTxInfo(hash)).resolves.toMatchObject({
      hash,
      blockHeight: height,
      validContract: false,
    });
    post.mockResolvedValueOnce({ status: 200, data: [] });
    await expect(provider.fetchTxInfo(hash)).rejects.toContain('"status":404');
  });

  it.each(["Yaci", "Iagon"] as const)(
    "maps %s's Blockfrost-compatible observation fields",
    async (name) => {
      const provider =
        name === "Yaci"
          ? new YaciProvider("https://yaci.test")
          : new IagonInsightProvider("key", "https://insight.test");
      const base = name === "Iagon" ? "/api/v0/" : "";
      const get = jest.fn().mockImplementation(async (path: string) => {
        switch (path) {
          case base + "blocks/latest":
            return {
              status: 200,
              data: { hash: blockHash, height, slot, epoch_slot: 2 },
            };
          case base + `txs/${hash}`:
            return {
              status: 200,
              data: {
                hash,
                block: blockHash,
                block_height: height,
                slot,
                valid_contract: false,
              },
            };
          case base + `txs/${hash}/utxos`:
            return { status: 200, data: { inputs: [], outputs: [] } };
          default:
            throw new Error(`Unexpected route: ${path}`);
        }
      });
      Object.assign(provider, {
        _axiosInstance: {
          get,
          request: ({ url }: { url: string }) => get(url),
        },
      });

      await expect(provider.fetchLatestBlock()).resolves.toMatchObject({
        hash: blockHash,
        height,
        slot: String(slot),
      });
      await expect(provider.fetchTxInfo(hash)).resolves.toMatchObject({
        blockHeight: height,
        validContract: false,
      });
      get.mockResolvedValueOnce({ status: 200, data: { hash, slot } });
      const transaction = await provider.fetchTxInfo(hash);
      expect(transaction).toMatchObject({
        blockHeight: undefined,
      });
      expect(
        (transaction as { validContract?: boolean }).validContract,
      ).toBeUndefined();
    },
  );

  it("reads the Nexus tip height", async () => {
    const provider = new NexusProvider("https://nexus.test/api");
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: { hash: blockHash, number: height, slot },
    });
    Object.assign(provider, { _axiosInstance: { get } });

    await expect(provider.fetchLatestBlock()).resolves.toMatchObject({
      hash: blockHash,
      height,
      slot: String(slot),
    });
    expect(get).toHaveBeenCalledWith("blocks/latest");
  });

  it.each([
    ["explicit failure", "84a0a0f4f6", blockHash, height, false],
    ["explicit success", "84a0a0f5f6", blockHash, height, true],
    ["pre-Alonzo encoding", "83a0a0f6", blockHash, height, undefined],
    ["truncated CBOR", "84a0a0f4", blockHash, height, undefined],
    ["different block", "84a0a0f5f6", "c3".repeat(32), undefined, undefined],
  ])(
    "reads Nexus transaction evidence for %s",
    async (_, cbor, responseBlock, expectedHeight, validity) => {
      const provider = new NexusProvider("https://nexus.test/api");
      const get = jest
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          data: { txHash: hash, block_hash: blockHash, absolute_slot: slot },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            txHash: hash,
            blockHash: responseBlock,
            blockHeight: height,
            cbor,
          },
        });
      Object.assign(provider, { _axiosInstance: { get } });

      const transaction = await provider.fetchTxInfo(hash);
      expect(transaction).toMatchObject({
        hash,
        block: blockHash,
        blockHeight: expectedHeight,
      });
      expect((transaction as { validContract?: boolean }).validContract).toBe(
        validity,
      );
      expect(get).toHaveBeenNthCalledWith(2, `transactions/${hash}/cbor`);
    },
  );

  it("keeps Nexus transaction details when CBOR is unavailable", async () => {
    const provider = new NexusProvider("https://nexus.test/api");
    const get = jest
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: { txHash: hash, block_hash: blockHash, block_height: height },
      })
      .mockRejectedValueOnce(new Error("CBOR unavailable"));
    Object.assign(provider, { _axiosInstance: { get } });

    const transaction = await provider.fetchTxInfo(hash);
    expect(transaction).toMatchObject({
      hash,
      blockHeight: height,
    });
    expect(transaction).not.toHaveProperty("validContract");
  });

  it("maps the devnet tip, confirmed transaction and absence", async () => {
    const provider = new MeshDevnetProvider();
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/block/latest") {
          return Response.json({ hash: blockHash, height, slot });
        }
        if (path === `/tx/${hash}`) {
          return Response.json({
            hash,
            block: blockHash,
            blockHeight: height,
            slot,
            validContract: false,
          });
        }
        return Response.json(
          { error: "Transaction not found" },
          { status: 404 },
        );
      });

    try {
      await expect(provider.fetchLatestBlock()).resolves.toMatchObject({
        hash: blockHash,
        height,
        slot: String(slot),
      });
      await expect(provider.fetchTxInfo(hash)).resolves.toMatchObject({
        blockHeight: height,
        validContract: false,
      });
      fetch.mockResolvedValueOnce(
        Response.json({ hash, blockHeight: null, slot }),
      );
      await expect(provider.fetchTxInfo(hash)).resolves.toMatchObject({
        blockHeight: undefined,
        validContract: undefined,
      });
      await expect(provider.fetchTxInfo("missing")).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      fetch.mockRestore();
    }
  });
});
