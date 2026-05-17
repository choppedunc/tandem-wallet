import {
  BaseSignerWalletAdapter,
  WalletNotReadyError,
  WalletReadyState,
  type SupportedTransactionVersions,
  type WalletName,
} from "@solana/wallet-adapter-base";
import type { TransactionOrVersionedTransaction } from "@solana/wallet-adapter-base";
import type { PublicKey } from "@solana/web3.js";

type InstallOnlyWalletConfig = {
  name: string;
  url: string;
  icon: string;
  deepLink?: () => string;
};

function isIosAndRedirectable() {
  if (typeof window === "undefined") return false;
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIos = userAgent.includes("iphone") || userAgent.includes("ipad");
  const isSafari = userAgent.includes("safari");
  return isIos && isSafari;
}

export class InstallOnlyWalletAdapter extends BaseSignerWalletAdapter {
  name: WalletName;
  url: string;
  icon: string;
  readyState: WalletReadyState;
  publicKey: PublicKey | null = null;
  connecting = false;
  supportedTransactionVersions: SupportedTransactionVersions = new Set([
    "legacy",
    0,
  ]);

  private deepLink?: () => string;

  constructor({ name, url, icon, deepLink }: InstallOnlyWalletConfig) {
    super();
    this.name = name as WalletName;
    this.url = url;
    this.icon = icon;
    this.deepLink = deepLink;
    this.readyState =
      deepLink && isIosAndRedirectable()
        ? WalletReadyState.Loadable
        : WalletReadyState.NotDetected;
  }

  async connect() {
    if (this.readyState === WalletReadyState.Loadable && this.deepLink) {
      window.location.href = this.deepLink();
      return;
    }

    throw new WalletNotReadyError();
  }

  async disconnect() {
    this.emit("disconnect");
  }

  async signTransaction<
    T extends TransactionOrVersionedTransaction<
      this["supportedTransactionVersions"]
    >,
  >(
    transaction: T
  ): Promise<T> {
    void transaction;
    throw new WalletNotReadyError();
  }
}

function createIconDataUri(label: string, background: string, foreground = "#001112") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="${background}"/><text x="48" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="800" fill="${foreground}">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const installOnlyWallets = [
  new InstallOnlyWalletAdapter({
    name: "Jupiter Wallet",
    url: "https://chromewebstore.google.com/detail/jupiter-wallet/iledlaeogohbilgbfhmbgkgmpplbfboh",
    icon: createIconDataUri("J", "#c7f44b"),
  }),
  new InstallOnlyWalletAdapter({
    name: "Backpack",
    url: "https://www.backpack.app/",
    icon: createIconDataUri("B", "#f47c2c", "#ffffff"),
  }),
  new InstallOnlyWalletAdapter({
    name: "Magic Eden",
    url: "https://wallet.magiceden.io/",
    icon: createIconDataUri("ME", "#7b3ff2", "#ffffff"),
  }),
  new InstallOnlyWalletAdapter({
    name: "Coinbase Wallet",
    url: "https://www.coinbase.com/wallet",
    icon: createIconDataUri("C", "#0052ff", "#ffffff"),
  }),
  new InstallOnlyWalletAdapter({
    name: "OKX Wallet",
    url: "https://www.okx.com/web3",
    icon: createIconDataUri("OK", "#111111", "#ffffff"),
  }),
];
