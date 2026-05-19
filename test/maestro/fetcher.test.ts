import { MaestroProvider } from "@meshsdk/core";

const apiKey = process.env.MAESTRO_API_KEY!;
const provider = new MaestroProvider({ apiKey, network: "Preprod" });

describe("maestro fetcher endpoint test", () => {
  it("should fetch cost models", async () => {
    const costModels = await provider.fetchCostModels();
    expect(costModels).toBeDefined();
    expect(Array.isArray(costModels)).toBe(true);
    expect(costModels.length).toBeGreaterThan(0);
    expect(Array.isArray(costModels[0])).toBe(true);
    expect(costModels[0].length).toBeGreaterThan(0);
  });
});
