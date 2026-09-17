import { BlockstreamEnterpriseBitcoinProvider } from "@meshsdk/provider";

const TOKEN_URL =
  "https://login.blockstream.com/realms/blockstream-public/protocol/openid-connect/token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BlockstreamEnterpriseBitcoinProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requests an OAuth token then calls the enterprise Esplora API with a Bearer header", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("client_id=test-id");
        expect(String(init?.body)).toContain("grant_type=client_credentials");
        return jsonResponse({
          access_token: "test-token",
          expires_in: 300,
          token_type: "Bearer",
        });
      }

      expect(url).toBe(
        "https://enterprise.blockstream.info/api/address/bc1qtest/utxo",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer test-token",
      );
      return jsonResponse([]);
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = new BlockstreamEnterpriseBitcoinProvider({
      clientId: "test-id",
      clientSecret: "test-secret",
      network: "mainnet",
    });

    await expect(provider.fetchAddressUTxOs("bc1qtest")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses a cached access token across requests", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        return jsonResponse({
          access_token: "cached-token",
          expires_in: 300,
          token_type: "Bearer",
        });
      }
      return jsonResponse({
        address: "bc1qtest",
        chain_stats: {},
        mempool_stats: {},
      });
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = new BlockstreamEnterpriseBitcoinProvider({
      clientId: "test-id",
      clientSecret: "test-secret",
      network: "mainnet",
    });

    await provider.fetchAddressInfo("bc1qtest");
    await provider.fetchAddressInfo("bc1qtest");

    const tokenCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input) === TOKEN_URL,
    );
    expect(tokenCalls).toHaveLength(1);
  });
});
