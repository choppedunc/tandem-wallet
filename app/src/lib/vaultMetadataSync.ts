import type { PublicKey } from "@solana/web3.js";
import {
  loadVaultMetadata,
  saveVaultMetadataSnapshot,
  type VaultMetadata,
} from "@/lib/vaultNames";

const AUTH_SESSION_KEY_PREFIX = "tandem:metadata-auth:v1";
const ENCRYPTION_SIGNATURE_KEY_PREFIX = "tandem:metadata-key:v1";
const AUTH_TTL_MS = 25 * 60 * 1000;
const AUTH_MESSAGE_MAX_AGE_MS = 30 * 60 * 1000;

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

type MetadataSigner = {
  publicKey: PublicKey;
  signMessage?: SignMessage;
};

type MetadataAuth = {
  walletAddress: string;
  message: string;
  signature: string;
  expiresAt: number;
};

type EncryptedMetadataPayload = {
  version: 1;
  iv: string;
  ciphertext: string;
  updatedAt: number;
};

type MetadataApiResponse = {
  payload?: EncryptedMetadataPayload | null;
  error?: string;
};

type MetadataStatusResponse = {
  configured?: boolean;
};

type SyncResult = {
  metadata: VaultMetadata;
  synced: boolean;
  error?: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let configuredPromise: Promise<boolean> | null = null;

function storageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Metadata sync is an enhancement. Local storage failures should not break vault use.
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function authSessionKey(walletAddress: string): string {
  return `${AUTH_SESSION_KEY_PREFIX}:${walletAddress}`;
}

function encryptionSignatureKey(walletAddress: string): string {
  return `${ENCRYPTION_SIGNATURE_KEY_PREFIX}:${walletAddress}`;
}

function createAuthMessage(walletAddress: string): {
  message: string;
  expiresAt: number;
} {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + AUTH_MESSAGE_MAX_AGE_MS;
  const origin = window.location.origin;
  const nonce = crypto.randomUUID();

  return {
    expiresAt,
    message: [
      "Tandem Wallet metadata sync",
      `Wallet: ${walletAddress}`,
      `Origin: ${origin}`,
      `Issued at: ${new Date(issuedAt).toISOString()}`,
      `Expires at: ${new Date(expiresAt).toISOString()}`,
      `Nonce: ${nonce}`,
      "This signature lets Tandem sync encrypted vault display metadata. It cannot move funds.",
    ].join("\n"),
  };
}

function createEncryptionMessage(walletAddress: string): string {
  return [
    "Tandem Wallet metadata encryption key",
    `Wallet: ${walletAddress}`,
    "App: tandemwallet.ai",
    "Purpose: Encrypt vault names and display order across your devices.",
    "This signature cannot move funds. Do not share it.",
  ].join("\n");
}

async function signBase64(
  signer: MetadataSigner,
  message: string
): Promise<string> {
  if (!signer.signMessage) {
    throw new Error("Connected wallet does not support message signing.");
  }

  const signature = await signer.signMessage(encoder.encode(message));
  return bytesToBase64(signature);
}

async function getAuth(signer: MetadataSigner): Promise<MetadataAuth> {
  const walletAddress = signer.publicKey.toBase58();
  const key = authSessionKey(walletAddress);
  const cached = storageGet(window.sessionStorage, key);

  if (cached) {
    try {
      const auth = JSON.parse(cached) as MetadataAuth;
      if (
        auth.walletAddress === walletAddress &&
        typeof auth.message === "string" &&
        typeof auth.signature === "string" &&
        typeof auth.expiresAt === "number" &&
        auth.expiresAt > Date.now() + 30_000
      ) {
        return auth;
      }
    } catch {
      // Ignore malformed cache entries.
    }
  }

  const { message, expiresAt } = createAuthMessage(walletAddress);
  const auth = {
    walletAddress,
    message,
    signature: await signBase64(signer, message),
    expiresAt: Math.min(expiresAt, Date.now() + AUTH_TTL_MS),
  };

  storageSet(window.sessionStorage, key, JSON.stringify(auth));
  return auth;
}

async function getEncryptionKey(signer: MetadataSigner): Promise<CryptoKey> {
  const walletAddress = signer.publicKey.toBase58();
  const key = encryptionSignatureKey(walletAddress);
  let signature = storageGet(window.localStorage, key);

  if (!signature) {
    signature = await signBase64(signer, createEncryptionMessage(walletAddress));
    storageSet(window.localStorage, key, signature);
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(base64ToBytes(signature))
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptMetadata(
  signer: MetadataSigner,
  metadata: VaultMetadata
): Promise<EncryptedMetadataPayload> {
  const key = await getEncryptionKey(signer);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(metadata));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext)
  );

  return {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: Date.now(),
  };
}

async function decryptMetadata(
  signer: MetadataSigner,
  payload: EncryptedMetadataPayload
): Promise<VaultMetadata> {
  const key = await getEncryptionKey(signer);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(payload.iv)) },
    key,
    toArrayBuffer(base64ToBytes(payload.ciphertext))
  );
  const parsed = JSON.parse(decoder.decode(decrypted)) as VaultMetadata;
  return normalizeMetadata(parsed);
}

function normalizeMetadata(metadata: VaultMetadata): VaultMetadata {
  const normalized: VaultMetadata = {};

  Object.entries(metadata).forEach(([address, entry]) => {
    if (!entry || typeof entry !== "object") return;

    const name = typeof entry.name === "string" ? entry.name.trim() : undefined;
    const createdAt =
      typeof entry.createdAt === "number" ? entry.createdAt : undefined;
    const updatedAt =
      typeof entry.updatedAt === "number" ? entry.updatedAt : undefined;

    if (!name && createdAt === undefined) return;
    normalized[address] = { name, createdAt, updatedAt };
  });

  return normalized;
}

function mergeMetadata(local: VaultMetadata, remote: VaultMetadata): VaultMetadata {
  const merged: VaultMetadata = {};
  const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);

  keys.forEach((key) => {
    const localEntry = local[key];
    const remoteEntry = remote[key];
    const localNameUpdatedAt = localEntry?.updatedAt ?? 0;
    const remoteNameUpdatedAt = remoteEntry?.updatedAt ?? 0;
    const name =
      localNameUpdatedAt >= remoteNameUpdatedAt
        ? localEntry?.name ?? remoteEntry?.name
        : remoteEntry?.name ?? localEntry?.name;
    const createdAt =
      localEntry?.createdAt !== undefined && remoteEntry?.createdAt !== undefined
        ? Math.min(localEntry.createdAt, remoteEntry.createdAt)
        : localEntry?.createdAt ?? remoteEntry?.createdAt;
    const updatedAt = Math.max(localNameUpdatedAt, remoteNameUpdatedAt) || undefined;

    if (name || createdAt !== undefined) {
      merged[key] = { name, createdAt, updatedAt };
    }
  });

  return merged;
}

async function requestMetadata(
  action: "load" | "save",
  signer: MetadataSigner,
  payload?: EncryptedMetadataPayload
): Promise<MetadataApiResponse> {
  const auth = await getAuth(signer);
  const response = await fetch("/api/vault-metadata", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, auth, payload }),
  });

  const result = (await response.json()) as MetadataApiResponse;
  if (!response.ok) {
    throw new Error(result.error ?? "Metadata sync failed.");
  }
  return result;
}

async function isMetadataSyncConfigured(): Promise<boolean> {
  configuredPromise ??= fetch("/api/vault-metadata", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return false;
      const status = (await response.json()) as MetadataStatusResponse;
      return Boolean(status.configured);
    })
    .catch(() => false);

  return configuredPromise;
}

export async function syncVaultMetadata(
  signer: MetadataSigner
): Promise<SyncResult> {
  if (typeof window === "undefined") {
    return { metadata: {}, synced: false };
  }

  try {
    if (!(await isMetadataSyncConfigured())) {
      return { metadata: loadVaultMetadata(), synced: false };
    }

    const local = loadVaultMetadata();
    const loaded = await requestMetadata("load", signer);
    const remote = loaded.payload
      ? await decryptMetadata(signer, loaded.payload)
      : {};
    const metadata = mergeMetadata(local, remote);

    saveVaultMetadataSnapshot(metadata);

    const encrypted = await encryptMetadata(signer, metadata);
    await requestMetadata("save", signer, encrypted);

    return { metadata, synced: true };
  } catch (error) {
    return {
      metadata: loadVaultMetadata(),
      synced: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
