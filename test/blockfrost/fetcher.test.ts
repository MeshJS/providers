import { BlockfrostProvider } from "@meshsdk/core";

describe("blockfrost fetcher endpoint test", () => {
  const apiKey = process.env.BLOCKFROST_API_KEY_PREPROD;
  const provider = new BlockfrostProvider(apiKey ?? "", 0);

  it("should fetch cost models", async () => {
    const costModels = await provider.fetchCostModels();
    expect(costModels).toBeDefined();
    expect(Array.isArray(costModels)).toBe(true);
    expect(costModels.length).toBeGreaterThan(0);
    expect(Array.isArray(costModels[0])).toBe(true);
    expect(costModels[0].length).toBeGreaterThan(0);
  });
});
