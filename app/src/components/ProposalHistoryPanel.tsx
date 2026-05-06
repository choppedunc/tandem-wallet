"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { formatUsdc, shortAddress } from "@/lib/format";
import { NETWORK } from "@/lib/network";
import {
  loadProposalTransactions,
  type ProposalTransactionRecord,
} from "@/lib/proposalTransactions";
import { getProgram } from "@/lib/program";
import type { VaultData } from "./VaultDetail";

type ProposalHistoryItem = {
  pda: PublicKey;
  proposalId: BN;
  recipient: PublicKey;
  recipientAta: PublicKey;
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

function explorerTxUrl(signature: string): string {
  const cluster = NETWORK === "mainnet-beta" ? "" : `?cluster=${NETWORK}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
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

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
        {label}
      </div>
      <div className="min-w-0 break-all text-sm font-display text-text">{value}</div>
    </div>
  );
}

function ProposalDetailModal({
  proposal,
  transaction,
  vault,
  onClose,
}: {
  proposal: ProposalHistoryItem;
  transaction?: ProposalTransactionRecord;
  vault: VaultData;
  onClose: () => void;
}) {
  const status = historyStatus(proposal);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="brackets max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6 shadow-[0_24px_80px_rgba(0,12,14,0.58)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
              Proposal details
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h3 className="font-display text-3xl font-bold text-text">
                {formatUsdc(proposal.amount)}
              </h3>
              <StatusBadge status={status} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-line-soft px-3 py-2 text-xs font-display uppercase tracking-[0.14em] text-muted hover:border-line hover:text-text"
          >
            Close
          </button>
        </div>

        <div className="mt-5 border-y border-line-soft">
          <DetailRow label="Proposal ID" value={proposal.proposalId.toString()} />
          <DetailRow label="Proposal PDA" value={proposal.pda.toBase58()} />
          <DetailRow label="Status" value={status} />
          <DetailRow label="Amount" value={formatUsdc(proposal.amount)} />
          <DetailRow label="Recipient wallet" value={proposal.recipient.toBase58()} />
          <DetailRow label="Recipient USDC" value={proposal.recipientAta.toBase58()} />
          <DetailRow label="Vault" value={vault.address.toBase58()} />
          <DetailRow label="Agent" value={vault.agent.toBase58()} />
          <DetailRow label="Memo" value={proposal.memo || "No memo supplied"} />
          <DetailRow label="Proposed" value={formatDate(proposal.proposedAt)} />
          <DetailRow
            label="Transaction ID"
            value={
              transaction ? (
                <a
                  href={explorerTxUrl(transaction.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:text-text underline underline-offset-4"
                >
                  {transaction.signature}
                </a>
              ) : (
                "Not recorded in this browser"
              )
            }
          />
          {transaction?.setupSignature && (
            <DetailRow
              label="Setup tx"
              value={
                <a
                  href={explorerTxUrl(transaction.setupSignature)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:text-text underline underline-offset-4"
                >
                  {transaction.setupSignature}
                </a>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ProposalHistoryPanel({ vault }: { vault: VaultData }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [items, setItems] = useState<ProposalHistoryItem[] | null>(null);
  const [selectedItem, setSelectedItem] = useState<ProposalHistoryItem | null>(null);
  const [transactions, setTransactions] = useState<Record<string, ProposalTransactionRecord>>({});
  const [error, setError] = useState<string | null>(null);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const refresh = useCallback(async () => {
    if (!program) return;
    setError(null);
    setTransactions(loadProposalTransactions());
    try {
      const accounts = await (program.account as any).proposal.all([
        { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
      ]);
      const mapped: ProposalHistoryItem[] = accounts.map((account: any) => ({
        pda: account.publicKey as PublicKey,
        proposalId: account.account.proposalId as BN,
        recipient: account.account.recipient as PublicKey,
        recipientAta: account.account.recipientAta as PublicKey,
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
    setTransactions(loadProposalTransactions());
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
              <button
                key={proposal.pda.toBase58()}
                type="button"
                onClick={() => setSelectedItem(proposal)}
                className="w-full border border-line-soft bg-[rgba(3,17,19,0.72)] p-4 text-left transition-colors hover:border-line"
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
                    {transactions[proposal.pda.toBase58()] && (
                      <div className="mt-2 truncate text-xs text-accent font-display">
                        Tx {transactions[proposal.pda.toBase58()].signature}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-muted font-display sm:text-right">
                    {formatDate(proposal.proposedAt)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedItem && (
        <ProposalDetailModal
          proposal={selectedItem}
          transaction={transactions[selectedItem.pda.toBase58()]}
          vault={vault}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
