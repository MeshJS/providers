import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";

import { YaciProvider } from "@meshsdk/provider";

describe("YaciProvider transaction responses", () => {
  let server: Server;
  let provider: YaciProvider;
  let responseStatus: number;
  let responseBody: unknown;

  beforeAll(async () => {
    server = createServer((request, response) => {
      request.resume();
      response.writeHead(responseStatus, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(responseBody));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    provider = new YaciProvider(`http://127.0.0.1:${port}/api/v1/`);
  });

  afterAll(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  describe.each([200, 202])("HTTP %i", (status) => {
    beforeEach(() => {
      responseStatus = status;
    });

    it("returns evaluation budgets as Mesh actions", async () => {
      responseBody = {
        result: {
          EvaluationResult: {
            "mint:0": { memory: 34914, steps: 11964079 },
            "spend:1": { memory: 10, steps: 20 },
            "certificate:2": { memory: 0, steps: 0 },
            "publish:3": { memory: 30, steps: 40 },
            "reward:4": { memory: 50, steps: 60 },
            "vote:5": { memory: 70, steps: 80 },
          },
        },
      };

      await expect(provider.evaluateTx("00")).resolves.toEqual([
        { tag: "MINT", index: 0, budget: { mem: 34914, steps: 11964079 } },
        { tag: "SPEND", index: 1, budget: { mem: 10, steps: 20 } },
        { tag: "CERT", index: 2, budget: { mem: 0, steps: 0 } },
        { tag: "CERT", index: 3, budget: { mem: 30, steps: 40 } },
        { tag: "REWARD", index: 4, budget: { mem: 50, steps: 60 } },
        { tag: "VOTE", index: 5, budget: { mem: 70, steps: 80 } },
      ]);
    });

    it("returns the submitted transaction hash", async () => {
      const hash = "a".repeat(64);
      responseBody = hash;

      await expect(provider.submitTx("00")).resolves.toBe(hash);
    });

    it.each([
      ["an error object", { error: "Transaction rejected" }],
      ["null", null],
      ["an empty response", ""],
      ["an array", []],
      ["a short hash", "abcd"],
      ["a non-hexadecimal hash", "g".repeat(64)],
      ["an error message", "Transaction rejected"],
    ])("rejects submission with %s", async (_description, body) => {
      responseBody = body;

      await expect(provider.submitTx("00")).rejects.toBeDefined();
    });

    it.each([
      ["an error object", { error: "Script evaluation failed" }],
      ["null", null],
      ["an empty response", ""],
      ["a missing result", {}],
      ["a null result", { result: null }],
      ["a missing evaluation", { result: {} }],
      ["a null evaluation", { result: { EvaluationResult: null } }],
      ["an array evaluation", { result: { EvaluationResult: [] } }],
      ["a string evaluation", { result: { EvaluationResult: "invalid" } }],
    ])("rejects evaluation with %s", async (_description, body) => {
      responseBody = body;

      await expect(provider.evaluateTx("00")).rejects.toBeDefined();
    });

    it("allows an evaluation with no redeemers", async () => {
      responseBody = { result: { EvaluationResult: {} } };

      await expect(provider.evaluateTx("00")).resolves.toEqual([]);
    });

    it.each([
      ["a null budget", { "mint:0": null }],
      ["a missing budget", { "mint:0": {} }],
      ["missing steps", { "mint:0": { memory: 1 } }],
      ["string units", { "mint:0": { memory: "1", steps: 2 } }],
      ["negative units", { "mint:0": { memory: 1, steps: -2 } }],
      ["fractional units", { "mint:0": { memory: 1.5, steps: 2 } }],
      ["an unknown tag", { "unknown:0": { memory: 1, steps: 2 } }],
      ["a missing index", { mint: { memory: 1, steps: 2 } }],
      ["an invalid index", { "mint:invalid": { memory: 1, steps: 2 } }],
      ["a negative index", { "mint:-1": { memory: 1, steps: 2 } }],
      ["an extra index", { "mint:0:1": { memory: 1, steps: 2 } }],
    ])("rejects evaluation containing %s", async (_description, evaluation) => {
      responseBody = { result: { EvaluationResult: evaluation } };

      await expect(provider.evaluateTx("00")).rejects.toBeDefined();
    });

    it.each(["evaluateTx", "submitTx"] as const)(
      "%s preserves backend error details from a success status",
      async (method) => {
        responseBody = { error: { code: 3010, message: "Transaction failed" } };

        await expect(provider[method]("00")).rejects.toContain(
          "Transaction failed",
        );
      },
    );
  });

  describe.each(["evaluateTx", "submitTx"] as const)("%s errors", (method) => {
    it.each([400, 500])("preserves HTTP %i error responses", async (status) => {
      responseStatus = status;
      responseBody = { message: "Transaction failed", details: "Invalid CBOR" };

      const result = provider[method]("00").catch((error) => {
        throw JSON.parse(error);
      });

      await expect(result).rejects.toMatchObject({ status, data: responseBody });
    });

    it.each([201, 204])("rejects unexpected HTTP %i responses", async (status) => {
      responseStatus = status;
      responseBody =
        method === "submitTx"
          ? "a".repeat(64)
          : { result: { EvaluationResult: {} } };

      await expect(provider[method]("00")).rejects.toBeDefined();
    });
  });
});
