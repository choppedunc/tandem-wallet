"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { formatUsdc, shortAddress } from "@/lib/format";
import { getProgram } from "@/lib/program";
import type { VaultData } from "./VaultDetail";

type ProposalHistoryItem = {
  pda: PublicKey;
  proposalId: BN;
  recipient: PublicKey;
  amount: BN;
  proposedAt: BN;
  executed: boolean;
  cancelled: boolean;
  memo: string;
};

function historyStatus(proposal: ProposalHistoryItem): "accepted" | "rejected" | "pending" {
  if (proposal.executed) return "accepted";
  if (proposal.cancelled) return "rejected";
  return "pending";
}

function formatDate(rawTimestamp: BN): string {
  const timestamp = Number(rawTimestamp.toString()) * 1000;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function StatusBadge({ status }: { status: ReturnType<typeof historyStatus> }) {
  const color =
    status === "accepted"
      ? "text-accent-2 border-line-soft"
      : status === "rejected"
        ? "text-muted border-line-soft"
        : "text-accent border-line";

  return (
    <span
      className={`border px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] font-display ${color}`}
    >
      {status}
    </span>
  );
}

export function ProposalHistoryPanel({ vault }: { vault: VaultData }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [items, setItems] = useState<ProposalHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const refresh = useCallback(async () => {
    if (!program) return;
    setError(null);
    try {
      const accounts = await (program.account as any).proposal.all([
        { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
      ]);
      const mapped: ProposalHistoryItem[] = accounts.map((account: any) => ({
        pda: account.publicKey as PublicKey,
        proposalId: account.account.proposalId as BN,
        recipient: account.account.recipient as PublicKey,
        amount: account.account.amount as BN,
        proposedAt: account.account.proposedAt as BN,
        executed: account.account.executed as boolean,
        cancelled: account.account.cancelled as boolean,
        memo: account.account.memo as string,
      }));
      mapped.sort((a, b) => b.proposalId.cmp(a.proposalId));
      setItems(mapped);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [program, vault.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
            Proposal history
          </p>
          <p className="mt-1 text-sm text-muted">
            Accepted, rejected, and pending approval requests.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="border border-line-soft px-3 py-2 text-xs uppercase tracking-wider font-display text-muted hover:border-line hover:text-text"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="text-muted text-sm font-display tracking-wider uppercase">
          Loading history...
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-line-soft p-10 text-center text-sm text-muted">
          No proposal history yet.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((proposal) => {
            const status = historyStatus(proposal);
            return (
              <div
                key={proposal.pda.toBase58()}
                className="border border-line-soft bg-[rgba(3,17,19,0.72)] p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
                        Proposal #{proposal.proposalId.toString()}
                      </span>
                      <StatusBadge status={status} />
                    </div>
                    <div className="mt-2 font-display text-xl font-bold text-text">
                      {formatUsdc(proposal.amount)}
                    </div>
                    <div className="mt-1 truncate text-sm text-muted font-display">
                      {shortAddress(proposal.recipient.toBase58(), 6)}
                    </div>
                    {proposal.memo && (
                      <div className="mt-2 text-sm text-muted">{proposal.memo}</div>
                    )}
                  </div>
                  <div className="text-sm text-muted font-display sm:text-right">
                    {formatDate(proposal.proposedAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
