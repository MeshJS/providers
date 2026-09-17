import {
  EsploraBitcoinClient,
  type BlockstreamNetwork,
} from "./bitcoin-esplora";
import { IBitcoinProvider } from "./types/bitcoin";

const TOKEN_URL =
  "https://login.blockstream.com/realms/blockstream-public/protocol/openid-connect/token";

const ENTERPRISE_BASE_URLS: Record<BlockstreamNetwork, string> = {
  mainnet: "https://enterprise.blockstream.info/api",
  testnet: "https://enterprise.blockstream.info/testnet/api",
};

const TOKEN_REFRESH_SKEW_MS = 60_000;

export interface BlockstreamEnterpriseBitcoinConfig {
  /** `client_id` from a Blockstream Explorer API key. */
  clientId: string;
  /** `client_secret` from a Blockstream Explorer API key. */
  clientSecret: string;
  network: BlockstreamNetwork;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

/**
 * Bitcoin provider for [Blockstream Explorer Enterprise](https://help.blockstream.com/blockstream-explorer-api/use-explorer-api/make-a-rest-api-request-with-your-api-keys).
 * Requires an API key pair (`clientId` + `clientSecret`) and uses the same Esplora REST API as the public provider.
 *
 * @example
 * ```ts
 * import { BlockstreamEnterpriseBitcoinProvider } from "@meshsdk/provider";
 *
 * const provider = new BlockstreamEnterpriseBitcoinProvider({
 *   clientId: "your-client-id",
 *   clientSecret: "your-client-secret",
 *   network: "mainnet",
 * });
 * ```
 */
export class BlockstreamEnterpriseBitcoinProvider
  extends EsploraBitcoinClient
  implements IBitcoinProvider
{
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private tokenRequest?: Promise<string>;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor({
    clientId,
    clientSecret,
    network,
  }: BlockstreamEnterpriseBitcoinConfig) {
    super({
      name: "BlockstreamEnterpriseBitcoinProvider",
      baseUrl: ENTERPRISE_BASE_URLS[network],
      getHeaders: () => this.authorizationHeaders(),
      onUnauthorized: () => this.invalidateToken(),
    });
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private invalidateToken(): void {
    this.accessToken = undefined;
    this.tokenExpiresAt = 0;
  }

  private async authorizationHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_SKEW_MS
    ) {
      return this.accessToken;
    }

    if (!this.tokenRequest) {
      this.tokenRequest = this.fetchAccessToken().finally(() => {
        this.tokenRequest = undefined;
      });
    }

    return this.tokenRequest;
  }

  private async fetchAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: "openid",
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const details = await res.text();
      throw new Error(
        `[BlockstreamEnterpriseBitcoinProvider] token request failed: ${res.status} ${res.statusText} ${details}`,
      );
    }

    const data = (await res.json()) as TokenResponse;
    if (!data.access_token) {
      throw new Error(
        "[BlockstreamEnterpriseBitcoinProvider] token response missing access_token",
      );
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 300) * 1000;
    return this.accessToken;
  }
}
