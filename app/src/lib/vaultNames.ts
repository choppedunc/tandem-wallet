import { PublicKey } from "@solana/web3.js";

const STORAGE_KEY = "tandem:vault-names:v1";

export type VaultNames = Record<string, string>;

export function fallbackVaultName(address: PublicKey): string {
  const value = address.toBase58();
  return `Vault ${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function loadVaultNames(): VaultNames {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as VaultNames;
  } catch {
    return {};
  }
}

export function saveVaultName(address: PublicKey | string, name: string): VaultNames {
  const key = typeof address === "string" ? address : address.toBase58();
  const current = loadVaultNames();
  const trimmed = name.trim();
  const next = { ...current };

  if (trimmed) next[key] = trimmed;
  else delete next[key];

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
