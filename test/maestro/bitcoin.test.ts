import { MaestroBitcoinProvider } from "@meshsdk/provider";

describe("MaestroBitcoinProvider", () => {
  const provider = new MaestroBitcoinProvider({
    apiKey: "unused",
    network: "mainnet",
  });

  it("still accepts constructor params", () => {
    expect(provider).toBeInstanceOf(MaestroBitcoinProvider);
  });

  it("throws that Maestro Bitcoin is no longer supported", async () => {
    await expect(provider.fetchAddressUTxOs("unused")).rejects.toThrow(
      /no longer supported/,
    );
  });
});
