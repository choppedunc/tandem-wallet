import BN from "bn.js";

const USDC_DECIMALS = 6;
const ONE_USDC_RAW = BigInt(1_000_000);

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

export function rawUsdcToInput(raw: BN | bigint | number): string {
  const rawBigInt = BigInt(raw.toString());
  const whole = rawBigInt / ONE_USDC_RAW;
  const fraction = rawBigInt % ONE_USDC_RAW;
  if (fraction === BigInt(0)) return whole.toString();
  const fractionText = fraction
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  return `${whole}.${fractionText}`;
}

export function formatSol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(4)} SOL`;
}

export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
