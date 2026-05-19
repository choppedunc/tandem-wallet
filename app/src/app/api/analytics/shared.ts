import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { neon } from "@neondatabase/serverless";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { NextResponse } from "next/server";
import idl from "@/lib/idl.json";
import { NETWORK, PROGRAM_ID, RPC_URL, type Network } from "@/lib/network";

export const ANALYTICS_NETWORK: Network = "mainnet-beta";
export const USDC_DECIMALS = 6;

const MAX_SYNC_LIMIT = 100;
const DEFAULT_SYNC_LIMIT = 50;
const tandemIdl = idl as unknown as Idl;

type RpcSignatureInfo = {
  signature: string;
  slot: number;
  blockTime: number | null;
};

type RpcTransaction = {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    logMessages: string[] | null;
  } | null;
} | null;

type TrackedEventName =
  | "VaultInitialized"
  | "UsdcSent"
  | "ProposalCreated"
  | "ProposalApproved"
  | "ProposalCancelled";

type AnalyticsEventRow = {
  network: Network;
  signature: string;
  eventIndex: number;
  programId: string;
  slot: number;
  blockTime: string | null;
  eventName: TrackedEventName;
  vault: string | null;
  humanWallet: string | null;
  agentWallet: string | null;
  signerWallet: string | null;
  recipientWallet: string | null;
  usdcMint: string | null;
  proposalId: string | null;
  amountUsdcRaw: string | null;
  feeUsdcRaw: string | null;
  whitelisted: boolean | null;
  memo: string | null;
};

type SyncStateRow = {
  latest_signature: string | null;
};

type InsertedRow = {
  signature: string;
};

let schemaInitialized = false;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function requireAnalyticsAuth(request: Request) {
  const configuredTokens = [
    process.env.ANALYTICS_ADMIN_TOKEN,
    process.env.CRON_SECRET,
  ].filter(Boolean);

  if (configuredTokens.length === 0) {
    return jsonError("Analytics auth token is not configured.", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !configuredTokens.includes(token)) {
    return jsonError("Unauthorized.", 401);
  }

  return null;
}

export function getSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Analytics database is not configured.");
  }
  return neon(databaseUrl);
}

export async function ensureAnalyticsSchema() {
  if (schemaInitialized) return;

  const sql = getSqlClient();
  await sql`
    CREATE TABLE IF NOT EXISTS tandem_analytics_events (
      network TEXT NOT NULL CHECK (network = 'mainnet-beta'),
      signature TEXT NOT NULL,
      event_index INTEGER NOT NULL,
      program_id TEXT NOT NULL,
      slot BIGINT NOT NULL,
      block_time TIMESTAMPTZ,
      event_name TEXT NOT NULL,
      vault TEXT,
      human_wallet TEXT,
      agent_wallet TEXT,
      signer_wallet TEXT,
      recipient_wallet TEXT,
      usdc_mint TEXT,
      proposal_id NUMERIC(20, 0),
      amount_usdc_raw NUMERIC(38, 0),
      fee_usdc_raw NUMERIC(38, 0),
      whitelisted BOOLEAN,
      memo TEXT,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (network, signature, event_index)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS tandem_analytics_events_name_idx
    ON tandem_analytics_events (network, event_name, block_time DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS tandem_analytics_events_vault_idx
    ON tandem_analytics_events (network, vault, block_time DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tandem_analytics_sync_state (
      network TEXT PRIMARY KEY CHECK (network = 'mainnet-beta'),
      latest_signature TEXT,
      latest_slot BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  schemaInitialized = true;
}

export function parseSyncLimit(value: string | null) {
  const fallback = Number(process.env.ANALYTICS_SYNC_LIMIT ?? DEFAULT_SYNC_LIMIT);
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SYNC_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_SYNC_LIMIT));
}

async function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `tandem-analytics-${method}`,
      method,
      params,
    }),
    cache: "no-store",
  });

  if (response.status === 429) {
    throw new Error("RPC rate limit");
  }
  if (!response.ok) {
    throw new Error(`RPC returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message ?? "RPC request failed");
  }

  return payload.result as T;
}

async function getLatestSignature() {
  const sql = getSqlClient();
  const rows = (await sql`
    SELECT latest_signature
    FROM tandem_analytics_sync_state
    WHERE network = ${ANALYTICS_NETWORK}
    LIMIT 1
  `) as SyncStateRow[];
  return rows[0]?.latest_signature ?? null;
}

async function saveLatestSignature(signature: string, slot: number) {
  const sql = getSqlClient();
  await sql`
    INSERT INTO tandem_analytics_sync_state (
      network,
      latest_signature,
      latest_slot,
      updated_at
    )
    VALUES (${ANALYTICS_NETWORK}, ${signature}, ${slot}, NOW())
    ON CONFLICT (network)
    DO UPDATE SET
      latest_signature = EXCLUDED.latest_signature,
      latest_slot = EXCLUDED.latest_slot,
      updated_at = NOW()
  `;
}

function asPublicKeyString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof PublicKey) return value.toBase58();
  if (
    typeof value === "object" &&
    "toBase58" in value &&
    typeof (value as { toBase58?: unknown }).toBase58 === "function"
  ) {
    return (value as { toBase58: () => string }).toBase58();
  }

  try {
    return new PublicKey(String(value)).toBase58();
  } catch {
    return null;
  }
}

function asNumericString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof BN) return value.toString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (
    typeof value === "object" &&
    "toString" in value &&
    typeof (value as { toString?: unknown }).toString === "function"
  ) {
    const text = (value as { toString: () => string }).toString();
    return /^\d+$/.test(text) ? text : null;
  }
  return null;
}

function field(data: Record<string, unknown>, snakeName: string, camelName?: string) {
  return data[snakeName] ?? (camelName ? data[camelName] : undefined);
}

function eventToAnalyticsRow(
  eventName: string,
  data: Record<string, unknown>,
  context: {
    signature: string;
    eventIndex: number;
    slot: number;
    blockTime: number | null;
    network: Network;
  }
): AnalyticsEventRow | null {
  const base = {
    network: context.network,
    signature: context.signature,
    eventIndex: context.eventIndex,
    programId: PROGRAM_ID.toBase58(),
    slot: context.slot,
    blockTime: context.blockTime
      ? new Date(context.blockTime * 1000).toISOString()
      : null,
    vault: asPublicKeyString(field(data, "vault")),
    humanWallet: null,
    agentWallet: null,
    signerWallet: null,
    recipientWallet: null,
    usdcMint: null,
    proposalId: null,
    amountUsdcRaw: null,
    feeUsdcRaw: null,
    whitelisted: null,
    memo: null,
  };

  if (eventName === "VaultInitialized") {
    return {
      ...base,
      eventName,
      humanWallet: asPublicKeyString(field(data, "human")),
      agentWallet: asPublicKeyString(field(data, "agent")),
      usdcMint: asPublicKeyString(field(data, "usdc_mint", "usdcMint")),
    };
  }

  if (eventName === "UsdcSent") {
    return {
      ...base,
      eventName,
      signerWallet: asPublicKeyString(field(data, "signer")),
      recipientWallet: asPublicKeyString(field(data, "recipient")),
      amountUsdcRaw: asNumericString(field(data, "amount")),
      feeUsdcRaw: asNumericString(field(data, "fee")),
      whitelisted: Boolean(field(data, "whitelisted")),
    };
  }

  if (eventName === "ProposalCreated") {
    return {
      ...base,
      eventName,
      recipientWallet: asPublicKeyString(field(data, "recipient")),
      proposalId: asNumericString(field(data, "proposal_id", "proposalId")),
      amountUsdcRaw: asNumericString(field(data, "amount")),
      memo:
        typeof field(data, "memo") === "string"
          ? String(field(data, "memo"))
          : null,
    };
  }

  if (eventName === "ProposalApproved") {
    return {
      ...base,
      eventName,
      recipientWallet: asPublicKeyString(field(data, "recipient")),
      proposalId: asNumericString(field(data, "proposal_id", "proposalId")),
      amountUsdcRaw: asNumericString(field(data, "amount")),
      feeUsdcRaw: asNumericString(field(data, "fee")),
    };
  }

  if (eventName === "ProposalCancelled") {
    return {
      ...base,
      eventName,
      proposalId: asNumericString(field(data, "proposal_id", "proposalId")),
    };
  }

  return null;
}

function parseAnalyticsEvents(
  signature: string,
  transaction: RpcTransaction,
  network: Network
) {
  const logs = transaction?.meta?.logMessages;
  if (!transaction || transaction.meta?.err || !logs) {
    return [];
  }

  const parser = new EventParser(PROGRAM_ID, new BorshCoder(tandemIdl));
  const rows: AnalyticsEventRow[] = [];
  let eventIndex = 0;

  for (const event of parser.parseLogs(logs)) {
    const row = eventToAnalyticsRow(
      event.name,
      event.data as Record<string, unknown>,
      {
        signature,
        eventIndex,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        network,
      }
    );
    if (row) rows.push(row);
    eventIndex += 1;
  }

  return rows;
}

async function insertAnalyticsEvents(events: AnalyticsEventRow[]) {
  if (events.length === 0) return 0;

  const sql = getSqlClient();
  let inserted = 0;
  for (const event of events) {
    const rows = (await sql`
      INSERT INTO tandem_analytics_events (
        network,
        signature,
        event_index,
        program_id,
        slot,
        block_time,
        event_name,
        vault,
        human_wallet,
        agent_wallet,
        signer_wallet,
        recipient_wallet,
        usdc_mint,
        proposal_id,
        amount_usdc_raw,
        fee_usdc_raw,
        whitelisted,
        memo
      )
      VALUES (
        ${event.network},
        ${event.signature},
        ${event.eventIndex},
        ${event.programId},
        ${event.slot},
        ${event.blockTime},
        ${event.eventName},
        ${event.vault},
        ${event.humanWallet},
        ${event.agentWallet},
        ${event.signerWallet},
        ${event.recipientWallet},
        ${event.usdcMint},
        ${event.proposalId},
        ${event.amountUsdcRaw},
        ${event.feeUsdcRaw},
        ${event.whitelisted},
        ${event.memo}
      )
      ON CONFLICT (network, signature, event_index) DO NOTHING
      RETURNING signature
    `) as InsertedRow[];
    inserted += rows.length;
  }

  return inserted;
}

export function formatUsdcRaw(raw: string | number | null | undefined) {
  const normalized = String(raw ?? "0").split(".")[0] || "0";
  const value = BigInt(normalized);
  const divisor = BigInt(10) ** BigInt(USDC_DECIMALS);
  const whole = value / divisor;
  const fraction = value % divisor;
  const trimmedFraction = fraction
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");

  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

export async function syncAnalyticsEvents(options: {
  limit: number;
  dryRun?: boolean;
  before?: string | null;
}) {
  const dryRun = Boolean(options.dryRun);
  const shouldWrite = NETWORK === ANALYTICS_NETWORK && !dryRun;

  if (NETWORK !== ANALYTICS_NETWORK && !dryRun) {
    return {
      ok: true,
      skipped: true,
      reason: "Analytics ingestion only writes mainnet-beta events.",
      network: NETWORK,
      writeEnabled: false,
      signaturesFetched: 0,
      transactionsParsed: 0,
      eventsFound: 0,
      eventsInserted: 0,
      failedTransactions: 0,
    };
  }

  if (shouldWrite) {
    await ensureAnalyticsSchema();
  }

  const latestSignature = shouldWrite && !options.before ? await getLatestSignature() : null;
  const signatureOptions: Record<string, unknown> = { limit: options.limit };
  if (options.before) {
    signatureOptions.before = options.before;
  } else if (latestSignature) {
    signatureOptions.until = latestSignature;
  }

  const signatures = await rpcRequest<RpcSignatureInfo[]>("getSignaturesForAddress", [
    PROGRAM_ID.toBase58(),
    signatureOptions,
  ]);

  const events: AnalyticsEventRow[] = [];
  let transactionsParsed = 0;
  let failedTransactions = 0;

  for (const signatureInfo of signatures) {
    try {
      const transaction = await rpcRequest<RpcTransaction>("getTransaction", [
        signatureInfo.signature,
        {
          encoding: "json",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!transaction) {
        failedTransactions += 1;
        continue;
      }
      transactionsParsed += 1;
      events.push(...parseAnalyticsEvents(signatureInfo.signature, transaction, NETWORK));
    } catch {
      failedTransactions += 1;
    }
  }

  const eventsInserted = shouldWrite ? await insertAnalyticsEvents(events) : 0;
  const cursorAdvanced = shouldWrite && signatures[0] && failedTransactions === 0;
  if (cursorAdvanced) {
    await saveLatestSignature(signatures[0].signature, signatures[0].slot);
  }

  return {
    ok: true,
    skipped: false,
    network: NETWORK,
    writeEnabled: shouldWrite,
    cursorMode: options.before ? "backfill" : latestSignature ? "incremental" : "initial",
    latestKnownSignature: latestSignature,
    newestFetchedSignature: signatures[0]?.signature ?? null,
    oldestFetchedSignature: signatures.at(-1)?.signature ?? null,
    cursorAdvanced,
    signaturesFetched: signatures.length,
    transactionsParsed,
    eventsFound: events.length,
    eventsInserted,
    failedTransactions,
  };
}
