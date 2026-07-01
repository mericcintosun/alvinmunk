/**
 * Stellar Wallets Kit connector (Level 2 / multi-wallet).
 *
 * The real StellarWalletsKit is the canonical multi-wallet picker for Stellar — it renders
 * one modal listing every installed/available wallet (Freighter, xBull, Albedo, Rabet,
 * LOBSTR, Hana) and normalizes connect + signing behind a single API. We expose it behind
 * the app's own `Wallet` interface so the rest of the app (balance, payments, contract calls)
 * is provider-agnostic.
 *
 * SWK is a browser-only web-component kit, so it is DYNAMICALLY imported inside the connect
 * call — it never touches SSR or the marketing bundle. Only light browser/extension modules
 * are registered (no Ledger/Trezor/WalletConnect) to keep the build lean.
 */
import { config, networkPassphrase } from './stellar';
import type { Wallet } from './wallet';

let inited = false;

/** Lazily load SWK + its light modules and init the (static) kit exactly once. */
async function ensureKit() {
  const [core, freighter, xbull, albedo, rabet, lobstr, hana] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit'),
    import('@creit.tech/stellar-wallets-kit/modules/freighter'),
    import('@creit.tech/stellar-wallets-kit/modules/xbull'),
    import('@creit.tech/stellar-wallets-kit/modules/albedo'),
    import('@creit.tech/stellar-wallets-kit/modules/rabet'),
    import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
    import('@creit.tech/stellar-wallets-kit/modules/hana'),
  ]);
  const { StellarWalletsKit, Networks, SwkAppDarkTheme } = core;
  if (!inited) {
    StellarWalletsKit.init({
      network: config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
      selectedWalletId: freighter.FREIGHTER_ID,
      // Match the app's dark cosmic palette instead of SWK's default light modal.
      theme: {
        ...SwkAppDarkTheme,
        background: '#120C1B',
        'background-secondary': '#0B0512',
        primary: '#8B5CF6',
        'primary-foreground': '#FFFFFF',
        border: '#2A2140',
        'border-radius': '14px',
      },
      modules: [
        new freighter.FreighterModule(),
        new xbull.xBullModule(),
        new albedo.AlbedoModule(),
        new rabet.RabetModule(),
        new lobstr.LobstrModule(),
        new hana.HanaModule(),
      ],
    });
    inited = true;
  }
  return StellarWalletsKit;
}

/**
 * Open the Stellar Wallets Kit picker, let the user choose + connect a wallet, and return it
 * behind the app's `Wallet` interface. Rejects if the user closes the modal or the wallet
 * isn't available (surfaced as a friendly error by the caller).
 */
export async function connectViaKit(): Promise<Wallet> {
  const kit = await ensureKit();
  const { address } = await kit.authModal();

  return {
    kind: 'kit',
    address,
    sign: async (xdr: string) => {
      const { signedTxXdr } = await kit.signTransaction(xdr, { address, networkPassphrase });
      return signedTxXdr;
    },
    signMessage: async (message: string) => {
      const { signedMessage } = await kit.signMessage(message, { address, networkPassphrase });
      // Kit returns a base64 signature string; some wallets return bytes — normalize to string.
      return typeof signedMessage === 'string' ? signedMessage : String(signedMessage);
    },
  };
}
