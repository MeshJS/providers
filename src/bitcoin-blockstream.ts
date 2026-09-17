import {
  EsploraBitcoinClient,
  type BlockstreamNetwork,
} from "./bitcoin-esplora";
import { IBitcoinProvider } from "./types/bitcoin";

export type { BlockstreamNetwork };

const BASE_URLS: Record<BlockstreamNetwork, string> = {
  mainnet: "https://blockstream.info/api",
  testnet: "https://blockstream.info/testnet/api",
};

/**
 * Bitcoin provider backed by the public Blockstream Esplora API.
 * No API key required.
 *
 * @example
 * ```ts
 * import { BlockstreamBitcoinProvider } from "@meshsdk/provider";
 * import { BitcoinHeadlessWallet } from "@meshsdk/wallet";
 *
 * const provider = new BlockstreamBitcoinProvider("testnet");
 * const wallet = await BitcoinHeadlessWallet.fromMnemonic({
 *   network: "Testnet4",
 *   mnemonic: [...],
 *   provider,
 * });
 * ```
 */
export class BlockstreamBitcoinProvider
  extends EsploraBitcoinClient
  implements IBitcoinProvider
{
  constructor(network: BlockstreamNetwork) {
    super({
      name: "BlockstreamBitcoinProvider",
      baseUrl: BASE_URLS[network],
    });
  }
}
