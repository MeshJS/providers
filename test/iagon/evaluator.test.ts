import { IagonInsightProvider } from "@meshsdk/provider";

const makeProvider = (request: (config: any) => Promise<any>) => {
  const provider = new IagonInsightProvider("key");
  (provider as any)._axiosInstance = { request: jest.fn(request) };
  return provider;
};

const axiosError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    response: { status, data: { success: false }, headers },
  });

describe("IagonInsightProvider evaluator and submitter", () => {
  it("maps redeemer purposes to mesh tags", async () => {
    const provider = makeProvider(async (config) => {
      expect(config.url).toBe("/v1/tx/evaluate");
      expect(config.data).toEqual({
        tx: "84a4",
        additionalUtxos: [],
        additionalTxs: ["84a5"],
      });
      return {
        data: {
          success: true,
          data: [
            { index: 0, purpose: "spend", memory: 10, cpu: 20 },
            { index: 1, purpose: "withdraw", memory: 11, cpu: 21 },
            { index: 0, purpose: "publish", memory: 12, cpu: 22 },
          ],
        },
      };
    });

    expect(await provider.evaluateTx("84a4", [], ["84a5"])).toEqual([
      { tag: "SPEND", index: 0, budget: { mem: 10, steps: 20 } },
      { tag: "REWARD", index: 1, budget: { mem: 11, steps: 21 } },
      { tag: "CERT", index: 0, budget: { mem: 12, steps: 22 } },
    ]);
  });

  it("asks a busy evaluate again after Retry-After", async () => {
    jest.useFakeTimers();
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      if (calls === 1) throw axiosError(503, { "retry-after": "1" });
      return { data: { success: true, data: [] } };
    });

    const done = provider.evaluateTx("84a4");
    await jest.advanceTimersByTimeAsync(1000);
    expect(await done).toEqual([]);
    expect(calls).toBe(2);
    jest.useRealTimers();
  });

  it("never sends a submit twice", async () => {
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      throw axiosError(503, { "retry-after": "1" });
    });

    await expect(provider.submitTx("84a400")).rejects.toMatch(/"status":503/);
    expect(calls).toBe(1);
  });

  it("submits the raw bytes as cbor", async () => {
    const provider = makeProvider(async (config) => {
      expect(config.url).toBe("/api/v0/tx/submit");
      expect(config.headers["Content-Type"]).toBe("application/cbor");
      expect([...config.data]).toEqual([0x84, 0xa4, 0x00]);
      return { data: "ab".repeat(32) };
    });

    expect(await provider.submitTx("84a400")).toBe("ab".repeat(32));
  });
});
