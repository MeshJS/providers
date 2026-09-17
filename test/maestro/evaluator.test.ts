import { MaestroProvider } from "@meshsdk/provider";

describe("Maestro Evaluator", () => {
  const provider = new MaestroProvider({
    apiKey: "unused",
    network: "Preprod",
  });

  it("throws that Maestro is no longer supported", async () => {
    await expect(provider.evaluateTx("00")).rejects.toThrow(
      /no longer supported/,
    );
  });
});
