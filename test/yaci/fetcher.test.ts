import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  core,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
  MeshTxBuilder,
  resolveScriptHash,
} from "@meshsdk/core";
import { YaciProvider } from "@meshsdk/provider";

describe("YaciProvider fetchCostModels", () => {
  let server: Server;
  let provider: YaciProvider;
  let responseStatus: number;
  let responseBody: unknown;
  let requests: string[];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
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

  beforeEach(() => {
    requests = [];
    responseStatus = 200;
    responseBody = {
      cost_models_raw: {
        PlutusV3: [30, 10, 20],
        PlutusV1: [3, 1, 2],
        PlutusV2: [6, 4, 5],
      },
      cost_models: { PlutusV1: { first: 999 } },
    };
  });

  afterAll(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("fetches the latest raw arrays in V1, V2, V3 order without reordering parameters", async () => {
    await expect(provider.fetchCostModels()).resolves.toEqual([
      [3, 1, 2],
      [6, 4, 5],
      [30, 10, 20],
    ]);
    expect(requests).toEqual(["GET /api/v1/epochs/latest/parameters"]);
  });

  it.each([0, 123])("fetches the requested epoch %i", async (epoch) => {
    await expect(provider.fetchCostModels(epoch)).resolves.toEqual([
      [3, 1, 2],
      [6, 4, 5],
      [30, 10, 20],
    ]);
    expect(requests).toEqual([`GET /api/v1/epochs/${epoch}/parameters`]);
  });

  it("accepts negative and boundary safe integers without imposing model lengths", async () => {
    responseBody = {
      cost_models_raw: {
        PlutusV1: [0],
        PlutusV2: [-1, 2],
        PlutusV3: [Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER, -5],
      },
    };

    await expect(provider.fetchCostModels()).resolves.toEqual([
      [0],
      [-1, 2],
      [Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER, -5],
    ]);
  });

  describe.each(["PlutusV1", "PlutusV2", "PlutusV3"])(
    "%s validation",
    (language) => {
      it.each([
        ["a missing model", undefined],
        ["null", null],
        ["an empty model", []],
        ["a string", "invalid"],
        ["named parameters", { first: 1, second: 2 }],
        ["numeric object keys", { 0: 1, 1: 2 }],
        ["a string parameter", [1, "2"]],
        ["a null parameter", [1, null]],
        ["a boolean parameter", [1, true]],
        ["a nested array", [1, [2]]],
        ["a fractional parameter", [1, 2.5]],
        ["an unsafe positive integer", [Number.MAX_SAFE_INTEGER + 1]],
        ["an unsafe negative integer", [Number.MIN_SAFE_INTEGER - 1]],
      ])("rejects %s with a useful error", async (_description, model) => {
        responseBody = {
          cost_models_raw: {
            PlutusV1: [1],
            PlutusV2: [2],
            PlutusV3: [3],
            [language]: model,
          },
        };

        await expect(provider.fetchCostModels()).rejects.toThrow(
          `Yaci returned no valid cost model for ${language}`,
        );
      });
    },
  );

  it.each([
    ["a null response", null],
    ["missing raw models", {}],
    ["null raw models", { cost_models_raw: null }],
    ["only named models", { cost_models: { PlutusV1: { first: 1 } } }],
  ])("rejects %s explicitly", async (_description, body) => {
    responseBody = body;

    await expect(provider.fetchCostModels()).rejects.toThrow(
      "Yaci returned no valid cost model for PlutusV1",
    );
  });

  it.each([404, 500])("preserves HTTP %i error details", async (status) => {
    responseStatus = status;
    responseBody = { message: "Protocol parameters unavailable" };

    const result = provider.fetchCostModels().catch((error) => {
      throw JSON.parse(error);
    });

    await expect(result).rejects.toMatchObject({ status, data: responseBody });
  });

  it.each([202, 204])(
    "rejects unexpected HTTP %i responses",
    async (status) => {
      responseStatus = status;

      await expect(provider.fetchCostModels()).rejects.toBeDefined();
    },
  );

  it.each(["automatic", "explicit"])(
    "%s fetching uses the chain's models in the final script-data hash",
    async (mode) => {
      const defaults = [
        DEFAULT_V1_COST_MODEL_LIST,
        DEFAULT_V2_COST_MODEL_LIST,
        DEFAULT_V3_COST_MODEL_LIST,
      ];
      // Change a shared parameter, so this also catches silently using defaults
      // when the chain's model lengths happen to match the SDK's.
      const chainModels = defaults.map((model) => [
        model[0]! + 1,
        ...model.slice(1),
      ]);
      responseBody = {
        cost_models_raw: {
          PlutusV3: chainModels[2],
          PlutusV1: chainModels[0],
          PlutusV2: chainModels[1],
        },
      };

      const address =
        "addr_test1qrhsnfvaqnd8r7dm9f9c5fscyfqmqzptyrn63dzrgvfw6p7vxwdrt70qlcpeeagscasafhffqsxy36t90ldv06wqrk2qkdr4hz";
      const script = "49480100002221200101";
      const policyId = resolveScriptHash(script, "V3");
      const makeBuilder = () =>
        new MeshTxBuilder({ fetcher: provider })
          .txIn(
            "11".repeat(32),
            0,
            [{ unit: "lovelace", quantity: "100000000" }],
            address,
            0,
          )
          .txInCollateral(
            "22".repeat(32),
            0,
            [{ unit: "lovelace", quantity: "5000000" }],
            address,
          )
          .mintPlutusScriptV3()
          .mint("1", policyId, "74657374")
          .mintingScript(script)
          .mintRedeemerValue(0, "Mesh", { mem: 1000, steps: 1000 })
          .changeAddress(address);

      // A direct chain-model build is the reference, independent of the provider.
      const expectedTx = await makeBuilder()
        .setCostModels(chainModels)
        .complete();
      const defaultTx = await makeBuilder().setCostModels(defaults).complete();
      const builder = makeBuilder();
      if (mode === "explicit") {
        builder.setCostModels(await provider.fetchCostModels());
      }
      const actualTx = await builder.complete();
      const scriptDataHash = (tx: string) =>
        core.deserializeTx(tx).body().scriptDataHash();

      expect(scriptDataHash(expectedTx)).toBeDefined();
      expect(scriptDataHash(actualTx)).toBe(scriptDataHash(expectedTx));
      expect(scriptDataHash(actualTx)).not.toBe(scriptDataHash(defaultTx));
      expect(requests).toEqual(["GET /api/v1/epochs/latest/parameters"]);
    },
  );
});
