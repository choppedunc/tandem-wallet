import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

export const runtime = "nodejs";

const AUTH_MAX_AGE_MS = 30 * 60 * 1000;
const AUTH_CLOCK_SKEW_MS = 2 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 100_000;

type MetadataAuth = {
  walletAddress: string;
  message: string;
  signature: string;
};

type MetadataPayload = {
  version: 1;
  iv: string;
  ciphertext: string;
  updatedAt: number;
};

type MetadataRequestBody = {
  action?: "load" | "save";
  auth?: MetadataAuth;
  payload?: MetadataPayload;
};

type MetadataRow = {
  payload: MetadataPayload;
};

let initialized = false;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function parseMessageField(message: string, label: string): string | null {
  const prefix = `${label}: `;
  const line = message.split("\n").find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

function validateAuth(auth: MetadataAuth): string {
  const publicKey = new PublicKey(auth.walletAddress);
  const messageBytes = new TextEncoder().encode(auth.message);
  const signatureBytes = decodeBase64(auth.signature);
  const verified = nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKey.toBytes()
  );

  if (!verified) {
    throw new Error("Invalid wallet signature.");
  }

  const messageWallet = parseMessageField(auth.message, "Wallet");
  if (messageWallet !== auth.walletAddress) {
    throw new Error("Signed message wallet does not match request wallet.");
  }

  const issuedAt = Date.parse(parseMessageField(auth.message, "Issued at") ?? "");
  const expiresAt = Date.parse(
    parseMessageField(auth.message, "Expires at") ?? ""
  );
  const now = Date.now();

  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    throw new Error("Signed message is missing valid timestamps.");
  }
  if (issuedAt > now + AUTH_CLOCK_SKEW_MS) {
    throw new Error("Signed message is from the future.");
  }
  if (expiresAt < now - AUTH_CLOCK_SKEW_MS) {
    throw new Error("Signed message has expired.");
  }
  if (expiresAt - issuedAt > AUTH_MAX_AGE_MS + AUTH_CLOCK_SKEW_MS) {
    throw new Error("Signed message expiry is too long.");
  }

  return auth.walletAddress;
}

function validatePayload(payload: unknown): MetadataPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Missing metadata payload.");
  }

  const candidate = payload as Partial<MetadataPayload>;
  if (
    candidate.version !== 1 ||
    typeof candidate.iv !== "string" ||
    typeof candidate.ciphertext !== "string" ||
    typeof candidate.updatedAt !== "number"
  ) {
    throw new Error("Invalid metadata payload.");
  }

  const size = Buffer.byteLength(JSON.stringify(candidate), "utf8");
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error("Metadata payload is too large.");
  }

  return {
    version: 1,
    iv: candidate.iv,
    ciphertext: candidate.ciphertext,
    updatedAt: candidate.updatedAt,
  };
}

function getSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Metadata database is not configured.");
  }
  return neon(databaseUrl);
}

async function ensureSchema() {
  if (initialized) return;

  const sql = getSqlClient();
  await sql`
    CREATE TABLE IF NOT EXISTS tandem_vault_metadata (
      owner_wallet TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  initialized = true;
}

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.DATABASE_URL) });
}

export async function POST(request: Request) {
  let body: MetadataRequestBody;
  try {
    body = (await request.json()) as MetadataRequestBody;
  } catch {
    return jsonError("Invalid JSON body.");
  }

  if (!body.auth) {
    return jsonError("Missing wallet authentication.");
  }

  try {
    const walletAddress = validateAuth(body.auth);
    await ensureSchema();
    const sql = getSqlClient();

    if (body.action === "load") {
      const rows = (await sql`
        SELECT payload
        FROM tandem_vault_metadata
        WHERE owner_wallet = ${walletAddress}
        LIMIT 1
      `) as MetadataRow[];
      return NextResponse.json({ payload: rows[0]?.payload ?? null });
    }

    if (body.action === "save") {
      const payload = validatePayload(body.payload);
      await sql`
        INSERT INTO tandem_vault_metadata (owner_wallet, payload, updated_at)
        VALUES (${walletAddress}, ${JSON.stringify(payload)}::jsonb, NOW())
        ON CONFLICT (owner_wallet)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `;
      return NextResponse.json({ ok: true });
    }

    return jsonError("Unsupported metadata action.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("configured") ? 503 : 400;
    return jsonError(message, status);
  }
}
