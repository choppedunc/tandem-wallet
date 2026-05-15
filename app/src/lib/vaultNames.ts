import { PublicKey } from "@solana/web3.js";

const STORAGE_KEY = "tandem:vault-names:v1";
const ORDER_STORAGE_KEY = "tandem:vault-created-order:v1";
const METADATA_STORAGE_KEY = "tandem:vault-metadata:v2";

export type VaultNames = Record<string, string>;
export type VaultCreatedOrder = Record<string, number>;
export type VaultMetadata = Record<
  string,
  {
    name?: string;
    createdAt?: number;
  }
>;

export function fallbackVaultName(address: PublicKey): string {
  const value = address.toBase58();
  return `Vault ${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readStorageObject<T extends Record<string, unknown>>(
  storageKey: string
): T {
  if (typeof window === "undefined") return {} as T;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {} as T;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {} as T;
    return parsed as T;
  } catch {
    return {} as T;
  }
}

function writeStorageObject(storageKey: string, value: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Keep vault actions usable even when local storage is unavailable.
  }
}

export function loadVaultMetadata(): VaultMetadata {
  const metadata = readStorageObject<VaultMetadata>(METADATA_STORAGE_KEY);
  const legacyNames = readStorageObject<VaultNames>(STORAGE_KEY);
  const legacyOrder = readStorageObject<VaultCreatedOrder>(ORDER_STORAGE_KEY);
  const keys = new Set([
    ...Object.keys(metadata),
    ...Object.keys(legacyNames),
    ...Object.keys(legacyOrder),
  ]);
  const merged: VaultMetadata = {};

  keys.forEach((key) => {
    const name =
      metadata[key]?.name ??
      (typeof legacyNames[key] === "string" ? legacyNames[key] : undefined);
    const createdAt =
      typeof metadata[key]?.createdAt === "number"
        ? metadata[key]?.createdAt
        : typeof legacyOrder[key] === "number"
          ? legacyOrder[key]
          : undefined;

    if (name || createdAt !== undefined) {
      merged[key] = { name, createdAt };
    }
  });

  return merged;
}

function saveVaultMetadata(
  address: PublicKey | string,
  patch: VaultMetadata[string]
): VaultMetadata {
  const key = typeof address === "string" ? address : address.toBase58();
  const metadata = loadVaultMetadata();
  const nextEntry = {
    ...metadata[key],
    ...patch,
  };
  const next = { ...metadata };

  if (!nextEntry.name) delete nextEntry.name;
  if (nextEntry.createdAt === undefined) delete nextEntry.createdAt;

  if (nextEntry.name || nextEntry.createdAt !== undefined) {
    next[key] = nextEntry;
  } else {
    delete next[key];
  }

  writeStorageObject(METADATA_STORAGE_KEY, next);
  return next;
}

export function loadVaultNames(): VaultNames {
  const metadata = loadVaultMetadata();
  return Object.fromEntries(
    Object.entries(metadata)
      .filter((entry): entry is [string, { name: string; createdAt?: number }] =>
        Boolean(entry[1].name)
      )
      .map(([address, entry]) => [address, entry.name])
  );
}

export function saveVaultName(address: PublicKey | string, name: string): VaultNames {
  const key = typeof address === "string" ? address : address.toBase58();
  const current = loadVaultNames();
  const trimmed = name.trim();
  const next = { ...current };

  if (trimmed) next[key] = trimmed;
  else delete next[key];

  writeStorageObject(STORAGE_KEY, next);
  saveVaultMetadata(key, { name: trimmed || undefined });
  return next;
}

export function loadVaultCreatedOrder(): VaultCreatedOrder {
  const metadata = loadVaultMetadata();
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(
        (
          entry
        ): entry is [string, { name?: string; createdAt: number }] =>
          typeof entry[1].createdAt === "number"
      )
      .map(([address, entry]) => [address, entry.createdAt])
  );
}

export function saveVaultCreatedAt(
  address: PublicKey | string,
  createdAt = Date.now()
): VaultCreatedOrder {
  const key = typeof address === "string" ? address : address.toBase58();
  const current = loadVaultCreatedOrder();
  const next = {
    ...current,
    [key]: current[key] ?? createdAt,
  };
  writeStorageObject(ORDER_STORAGE_KEY, next);
  saveVaultMetadata(key, { createdAt: next[key] });
  return next;
}
