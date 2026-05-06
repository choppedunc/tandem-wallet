import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import idl from "@/lib/idl.json";
import { PROGRAM_ID, RPC_URL } from "@/lib/network";
import { proposalPda } from "@/lib/pdas";

const TX_HISTORY_SIGNATURE_LIMIT = 20;
const CACHE_MS = 30_000;

type RpcSignatureInfo = {
  signature: string;
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

type HistoryResponse = {
  directSends: {
    id: string;
    signature: string;
    slot: number;
    blockTime: number | null;
    signer: string;
    recipient: string;
    amount: string;
    fee: string;
    whitelisted: boolean;
  }[];
  proposalTransactions: Record<
    string,
    {
      action: "approved" | "cancelled";
      signature: string;
      recordedAt: string;
      blockTime: number | null;
      slot: number;
    }
  >;
  incomplete: boolean;
};

const cache = new Map<string, { loadedAt: number; response: HistoryResponse }>();
const inFlight = new Map<string, Promise<HistoryResponse>>();

async function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `tandem-${method}`,
      method,
      params,
    }),
    cache: "no-store",
  });

  if (response.status === 429) {
    throw new Error("Devnet RPC rate limit");
  }
  if (!response.ok) {
    throw new Error(`Devnet RPC returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message ?? "Devnet RPC request failed");
  }

  return payload.result as T;
}

function asPublicKey(value: unknown): PublicKey {
  if (value instanceof PublicKey) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toBase58" in value &&
    typeof (value as { toBase58?: unknown }).toBase58 === "function"
  ) {
    return new PublicKey((value as { toBase58: () => string }).toBase58());
  }
  return new PublicKey(String(value));
}

function asBn(value: unknown): BN {
  if (value instanceof BN) return value;
  return new BN(String(value));
}

async function fetchVaultHistory(vault: PublicKey): Promise<HistoryResponse> {
  const cacheKey = vault.toBase58();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) {
    return cached.response;
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    const parser = new EventParser(PROGRAM_ID, new BorshCoder(idl as any));
    const signatures = await rpcRequest<RpcSignatureInfo[]>("getSignaturesForAddress", [
      vault.toBase58(),
      { limit: TX_HISTORY_SIGNATURE_LIMIT },
    ]);
    const directSends: HistoryResponse["directSends"] = [];
    const proposalTransactions: HistoryResponse["proposalTransactions"] = {};
    let incomplete = false;

    for (const signatureInfo of signatures) {
      let transaction: RpcTransaction;
      try {
        transaction = await rpcRequest<RpcTransaction>("getTransaction", [
          signatureInfo.signature,
          {
            encoding: "json",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          },
        ]);
      } catch {
        incomplete = true;
        continue;
      }

      const logs = transaction?.meta?.logMessages;
      if (!transaction || transaction.meta?.err || !logs) continue;

      const blockTime = transaction.blockTime ?? signatureInfo.blockTime ?? null;
      let eventIndex = 0;

      for (const event of parser.parseLogs(logs)) {
        const data = event.data as Record<string, unknown>;
        if (!data.vault || !asPublicKey(data.vault).equals(vault)) continue;

        if (event.name === "UsdcSent") {
          directSends.push({
            id: `${signatureInfo.signature}:${eventIndex}`,
            signature: signatureInfo.signature,
            slot: transaction.slot,
            blockTime,
            signer: asPublicKey(data.signer).toBase58(),
            recipient: asPublicKey(data.recipient).toBase58(),
            amount: asBn(data.amount).toString(),
            fee: asBn(data.fee).toString(),
            whitelisted: Boolean(data.whitelisted),
          });
        }

        if (event.name === "ProposalApproved" || event.name === "ProposalCancelled") {
          const proposalId = asBn(data.proposal_id ?? data.proposalId);
          const proposalKey = proposalPda(vault, proposalId).toBase58();
          proposalTransactions[proposalKey] = {
            action: event.name === "ProposalApproved" ? "approved" : "cancelled",
            signature: signatureInfo.signature,
            recordedAt: blockTime
              ? new Date(blockTime * 1000).toISOString()
              : new Date().toISOString(),
            blockTime,
            slot: transaction.slot,
          };
        }

        eventIndex += 1;
      }
    }

    const response = { directSends, proposalTransactions, incomplete };
    cache.set(cacheKey, { loadedAt: Date.now(), response });
    return response;
  })();

  inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(cacheKey);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vaultParam = searchParams.get("vault");

  if (!vaultParam) {
    return NextResponse.json({ error: "Missing vault address." }, { status: 400 });
  }

  try {
    const vault = new PublicKey(vaultParam);
    const history = await fetchVaultHistory(vault);
    return NextResponse.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
