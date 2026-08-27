import { NexusProvider, NexusSupportedNetworks } from "@meshsdk/provider";

/**
 * The `?network=` query param is what tells an unauthenticated or self-hosted
 * Nexus instance which chain to read; without it the server falls back to
 * preprod. These tests drive the real axios instance through a stub adapter so
 * the wire URL is asserted, not the call arguments.
 */
const capture = (provider: NexusProvider) => {
  const urls: string[] = [];
  const axiosInstance = (provider as any)._axiosInstance;
  axiosInstance.defaults.adapter = async (config: any) => {
    urls.push(axiosInstance.getUri(config));
    return { status: 200, data: {}, config, headers: {} };
  };
  return urls;
};

describe("NexusProvider network param", () => {
  it.each<[NexusSupportedNetworks, string]>([
    ["CARDANO_MAINNET", "CARDANO_MAINNET"],
    ["CARDANO_PREPROD", "CARDANO_PREPROD"],
    ["CARDANO_PREVIEW", "CARDANO_PREVIEW"],
    ["cardano-mainnet", "CARDANO_MAINNET"],
    ["cardano-preprod", "CARDANO_PREPROD"],
    ["cardano-preview", "CARDANO_PREVIEW"],
    ["mainnet", "CARDANO_MAINNET"],
    ["preprod", "CARDANO_PREPROD"],
    ["preview", "CARDANO_PREVIEW"],
  ])("sends the schema enum id for %s", async (network, expected) => {
    const provider = new NexusProvider(
      "https://nexus.test/api",
      "nxs_key",
      network,
    );
    const urls = capture(provider);

    await provider.get("blocks/latest");

    expect(urls[0]).toBe(
      `https://nexus.test/api/blocks/latest?network=${expected}`,
    );
  });

  it("matches case-insensitively, as Nexus itself does", async () => {
    const provider = new NexusProvider(
      "nxs_key",
      "Cardano-Preview" as NexusSupportedNetworks,
    );
    const urls = capture(provider);

    await provider.get("blocks/latest");

    expect(urls[0]).toBe(
      "https://nexus.gerowallet.io/api/blocks/latest?network=CARDANO_PREVIEW",
    );
  });

  it("appends to endpoints that already carry a query string", async () => {
    const provider = new NexusProvider(
      "https://nexus.test/api",
      undefined,
      "preview",
    );
    const urls = capture(provider);

    await provider.get("addresses/transactions/addr1?page=1&pageSize=100");

    expect(urls[0]).toBe(
      "https://nexus.test/api/addresses/transactions/addr1?page=1&pageSize=100&network=CARDANO_PREVIEW",
    );
  });

  it("sends the param on writes too", async () => {
    const provider = new NexusProvider("nxs_key", "preprod");
    const urls = capture(provider);

    await provider.post("transactions/submit", "aabb");

    expect(urls[0]).toBe(
      "https://nexus.gerowallet.io/api/transactions/submit?network=CARDANO_PREPROD",
    );
  });

  it("omits the param when no network is given, so a network-scoped API key still decides", async () => {
    const provider = new NexusProvider("nxs_key");
    const urls = capture(provider);

    await provider.get("blocks/latest");

    expect(urls[0]).toBe("https://nexus.gerowallet.io/api/blocks/latest");
  });

  it("rejects a network it cannot map, rather than silently dropping it", () => {
    // The usual caller is `process.env.X as NexusSupportedNetworks`, which the
    // compiler cannot check — so this has to fail at runtime.
    expect(
      () => new NexusProvider("nxs_key", "preprodd" as NexusSupportedNetworks),
    ).toThrow(/unsupported network "preprodd"/);

    expect(
      () =>
        new NexusProvider(
          "nxs_key",
          "BITCOIN_MAINNET" as NexusSupportedNetworks,
        ),
    ).toThrow(/unsupported network "BITCOIN_MAINNET"/);
  });

  it("still guards handle resolution to mainnet, whichever spelling was used", async () => {
    await expect(
      new NexusProvider("nxs_key", "CARDANO_PREPROD").fetchHandleAddress(
        "$mesh",
      ),
    ).rejects.toThrow(/non-mainnet networks/);

    await expect(
      new NexusProvider("nxs_key", "cardano-preprod").fetchHandle("$mesh"),
    ).rejects.toThrow(/non-mainnet networks/);

    await expect(
      new NexusProvider("nxs_key", "preprod").fetchHandle("$mesh"),
    ).rejects.toThrow(/non-mainnet networks/);
  });
});
