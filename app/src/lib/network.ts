import { PublicKey } from "@solana/web3.js";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";

export type Network = "devnet" | "mainnet-beta";

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "devnet") as Network;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
);
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

export const WALLET_NETWORK: WalletAdapterNetwork =
  NETWORK === "mainnet-beta"
    ? WalletAdapterNetwork.Mainnet
    : WalletAdapterNetwork.Devnet;

export function explorerTxUrl(signature: string): string {
  const cluster = NETWORK === "mainnet-beta" ? "" : `?cluster=${NETWORK}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
