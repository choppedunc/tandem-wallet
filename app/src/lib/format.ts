import BN from "bn.js";

const USDC_DECIMALS = 6;

export function rawToUsdc(raw: BN | bigint | number): number {
  const n = typeof raw === "number" ? raw : Number(raw.toString());
  return n / 10 ** USDC_DECIMALS;
}

export function usdcToRaw(usdc: number): BN {
  return new BN(Math.round(usdc * 10 ** USDC_DECIMALS));
}

export function formatUsdc(raw: BN | bigint | number): string {
  return `${rawToUsdc(raw).toFixed(2)} USDC`;
}

export function formatSol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(4)} SOL`;
}

export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
