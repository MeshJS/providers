import { MaestroProvider } from "@meshsdk/provider";

describe("MaestroProvider", () => {
  const provider = new MaestroProvider({
    apiKey: "unused",
    network: "Preprod",
  });

  it("still accepts constructor params", () => {
    expect(provider).toBeInstanceOf(MaestroProvider);
  });

  it("throws that Maestro is no longer supported", async () => {
    await expect(provider.fetchCostModels()).rejects.toThrow(
      /no longer supported/,
    );
  });
});
