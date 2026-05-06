"use client";

import { EventParser } from "@coral-xyz/anchor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { formatUsdc, shortAddress } from "@/lib/format";
import { NETWORK, PROGRAM_ID } from "@/lib/network";
import { proposalPda } from "@/lib/pdas";
import {
  loadProposalTransactions,
  type ProposalTransactionRecord,
} from "@/lib/proposalTransactions";
import { getProgram } from "@/lib/program";
import type { VaultData } from "./VaultDetail";

const TX_HISTORY_SIGNATURE_LIMIT = 100;
const TX_HISTORY_BATCH_SIZE = 10;

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

type DirectSendHistoryItem = {
  id: string;
  signature: string;
  slot: number;
  blockTime: number | null;
  signer: PublicKey;
  recipient: PublicKey;
  amount: BN;
  fee: BN;
  whitelisted: boolean;
};

type HistoryProposalTransaction = ProposalTransactionRecord & {
  blockTime?: number | null;
  slot?: number;
};

type ChainEventHistory = {
  directSends: DirectSendHistoryItem[];
  proposalTransactions: Record<string, HistoryProposalTransaction>;
};

type ProposalHistoryRow = {
  kind: "proposal";
  id: string;
  proposal: ProposalHistoryItem;
  sortTime: number;
};

type DirectSendHistoryRow = {
  kind: "direct-send";
  id: string;
  transfer: DirectSendHistoryItem;
  sortTime: number;
};

type HistoryRow = ProposalHistoryRow | DirectSendHistoryRow;

function historyStatus(proposal: ProposalHistoryItem): "accepted" | "rejected" | "pending" {
  if (proposal.executed) return "accepted";
  if (proposal.cancelled) return "rejected";
  return "pending";
}

function explorerTxUrl(signature: string): string {
  const cluster = NETWORK === "mainnet-beta" ? "" : `?cluster=${NETWORK}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

function formatUnixDate(rawTimestamp: BN | number | null | undefined): string {
  if (rawTimestamp === null || rawTimestamp === undefined) return "Unknown";
  const timestamp =
    typeof rawTimestamp === "number"
      ? rawTimestamp
      : Number(rawTimestamp.toString());
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function normalizeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { message?: string };
    if (maybeError.message) return maybeError.message;
  }
  return String(error);
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

function isVaultEvent(data: Record<string, unknown>, vault: PublicKey): boolean {
  try {
    return asPublicKey(data.vault).equals(vault);
  } catch {
    return false;
  }
}

function proposalIdFromEvent(data: Record<string, unknown>): BN {
  return asBn(data.proposal_id ?? data.proposalId);
}

function mergeTransactionRecords(
  local: Record<string, ProposalTransactionRecord>,
  chain: Record<string, HistoryProposalTransaction>
): Record<string, HistoryProposalTransaction> {
  const merged: Record<string, HistoryProposalTransaction> = { ...chain };
  Object.entries(local).forEach(([proposal, record]) => {
    merged[proposal] = {
      ...chain[proposal],
      ...record,
      blockTime: chain[proposal]?.blockTime,
      slot: chain[proposal]?.slot,
    };
  });
  return merged;
}

function proposalSortTime(
  proposal: ProposalHistoryItem,
  transaction?: HistoryProposalTransaction
): number {
  return transaction?.blockTime ?? Number(proposal.proposedAt.toString());
}

function StatusBadge({ status }: { status: ReturnType<typeof historyStatus> }) {
  const color =
    status === "accepted"
      ? "text-[#8fd8bd] border-[#5ec99a]/40 bg-[#123528]"
      : status === "rejected"
        ? "text-[#e7a6a6] border-[#d66b6b]/35 bg-[#3a1719]"
        : "text-accent border-line";

  return (
    <span
      className={`border px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] font-display ${color}`}
    >
      {status}
    </span>
  );
}

function DirectSendBadge({
  transfer,
  vault,
}: {
  transfer: DirectSendHistoryItem;
  vault: VaultData;
}) {
  const label = transfer.signer.equals(vault.agent)
    ? transfer.whitelisted
      ? "whitelisted"
      : "within allowance"
    : transfer.signer.equals(vault.human)
      ? "human send"
      : "direct send";

  return (
    <span className="border border-line-soft px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] font-display text-accent">
      {label}
    </span>
  );
}

function historyCardClass(expanded: boolean): string {
  const active = expanded ? "ring-1 ring-line-soft" : "";
  return `w-full border border-line-soft bg-[rgba(3,17,19,0.72)] p-4 text-left transition-colors hover:border-line ${active}`;
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

function TransactionLink({ signature }: { signature: string }) {
  return (
    <a
      href={explorerTxUrl(signature)}
      target="_blank"
      rel="noreferrer"
      className="text-accent hover:text-text underline underline-offset-4"
    >
      {signature}
    </a>
  );
}

function ExpandedProposalDetails({
  proposal,
  transaction,
  vault,
}: {
  proposal: ProposalHistoryItem;
  transaction?: HistoryProposalTransaction;
  vault: VaultData;
}) {
  const status = historyStatus(proposal);

  return (
    <div className="mt-4 border-t border-line-soft pt-4">
      <div className="border-y border-line-soft">
        <DetailRow label="Proposal ID" value={proposal.proposalId.toString()} />
        <DetailRow label="Proposal PDA" value={proposal.pda.toBase58()} />
        <DetailRow label="Status" value={status} />
        <DetailRow label="Amount" value={formatUsdc(proposal.amount)} />
        <DetailRow label="Recipient wallet" value={proposal.recipient.toBase58()} />
        <DetailRow label="Recipient USDC" value={proposal.recipientAta.toBase58()} />
        <DetailRow label="Vault" value={vault.address.toBase58()} />
        <DetailRow label="Agent" value={vault.agent.toBase58()} />
        <DetailRow label="Memo" value={proposal.memo || "No memo supplied"} />
        <DetailRow label="Proposed" value={formatUnixDate(proposal.proposedAt)} />
        <DetailRow
          label="Transaction ID"
          value={
            transaction ? (
              <TransactionLink signature={transaction.signature} />
            ) : (
              "Not found in recent vault transactions"
            )
          }
        />
        {transaction?.blockTime !== undefined && (
          <DetailRow
            label="Confirmed"
            value={formatUnixDate(transaction.blockTime)}
          />
        )}
        {transaction?.setupSignature && (
          <DetailRow
            label="Setup tx"
            value={<TransactionLink signature={transaction.setupSignature} />}
          />
        )}
      </div>
    </div>
  );
}

function ExpandedDirectSendDetails({
  transfer,
  vault,
}: {
  transfer: DirectSendHistoryItem;
  vault: VaultData;
}) {
  const source = transfer.signer.equals(vault.agent)
    ? transfer.whitelisted
      ? "Agent direct send, whitelist bypass"
      : "Agent allowance send"
    : transfer.signer.equals(vault.human)
      ? "Human direct send"
      : "Direct send";

  return (
    <div className="mt-4 border-t border-line-soft pt-4">
      <div className="border-y border-line-soft">
        <DetailRow label="Type" value={source} />
        <DetailRow label="Status" value="completed" />
        <DetailRow label="Amount" value={formatUsdc(transfer.amount)} />
        <DetailRow label="Protocol fee" value={formatUsdc(transfer.fee)} />
        <DetailRow label="Recipient wallet" value={transfer.recipient.toBase58()} />
        <DetailRow label="Signer" value={transfer.signer.toBase58()} />
        <DetailRow label="Vault" value={vault.address.toBase58()} />
        <DetailRow label="Agent" value={vault.agent.toBase58()} />
        <DetailRow label="Human approval" value="Not required" />
        <DetailRow
          label="Whitelist bypass"
          value={transfer.whitelisted ? "Yes" : "No"}
        />
        <DetailRow
          label="Transaction ID"
          value={<TransactionLink signature={transfer.signature} />}
        />
        <DetailRow label="Confirmed" value={formatUnixDate(transfer.blockTime)} />
      </div>
    </div>
  );
}

export function ProposalHistoryPanel({ vault }: { vault: VaultData }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Record<string, HistoryProposalTransaction>>({});
  const [error, setError] = useState<string | null>(null);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const loadVaultEvents = useCallback(async (): Promise<ChainEventHistory> => {
    if (!program) return { directSends: [], proposalTransactions: {} };

    const parser = new EventParser(PROGRAM_ID, (program as any).coder);
    const signatures = await connection.getSignaturesForAddress(vault.address, {
      limit: TX_HISTORY_SIGNATURE_LIMIT,
    });
    const directSends: DirectSendHistoryItem[] = [];
    const proposalTransactions: Record<string, HistoryProposalTransaction> = {};

    for (let start = 0; start < signatures.length; start += TX_HISTORY_BATCH_SIZE) {
      const signatureBatch = signatures.slice(start, start + TX_HISTORY_BATCH_SIZE);
      const transactions = await connection.getTransactions(
        signatureBatch.map((signatureInfo) => signatureInfo.signature),
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }
      );

      for (const [index, transaction] of transactions.entries()) {
        const signatureInfo = signatureBatch[index];
        const logs = transaction?.meta?.logMessages;
        if (!transaction || transaction.meta?.err || !logs) continue;

        const blockTime = transaction.blockTime ?? signatureInfo.blockTime ?? null;
        let eventIndex = 0;

        for (const event of parser.parseLogs(logs)) {
          const data = event.data as Record<string, unknown>;
          if (!isVaultEvent(data, vault.address)) continue;

          if (event.name === "UsdcSent") {
            directSends.push({
              id: `${signatureInfo.signature}:${eventIndex}`,
              signature: signatureInfo.signature,
              slot: transaction.slot,
              blockTime,
              signer: asPublicKey(data.signer),
              recipient: asPublicKey(data.recipient),
              amount: asBn(data.amount),
              fee: asBn(data.fee),
              whitelisted: Boolean(data.whitelisted),
            });
          }

          if (event.name === "ProposalApproved" || event.name === "ProposalCancelled") {
            const proposalId = proposalIdFromEvent(data);
            const proposalKey = proposalPda(vault.address, proposalId).toBase58();
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
    }

    return { directSends, proposalTransactions };
  }, [connection, program, vault.address]);

  const refresh = useCallback(async () => {
    if (!program) return;

    const localTransactions = loadProposalTransactions();
    setTransactions(localTransactions);
    setError(null);

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

      let chainHistory: ChainEventHistory = {
        directSends: [],
        proposalTransactions: {},
      };
      let scanError: string | null = null;

      try {
        chainHistory = await loadVaultEvents();
      } catch (eventError) {
        scanError = `Loaded proposals, but recent direct transaction scan failed: ${normalizeError(
          eventError
        )}`;
      }

      const mergedTransactions = mergeTransactionRecords(
        localTransactions,
        chainHistory.proposalTransactions
      );
      const nextRows: HistoryRow[] = [
        ...mapped.map((proposal) => {
          const proposalKey = proposal.pda.toBase58();
          return {
            kind: "proposal" as const,
            id: proposalKey,
            proposal,
            sortTime: proposalSortTime(proposal, mergedTransactions[proposalKey]),
          };
        }),
        ...chainHistory.directSends.map((transfer) => ({
          kind: "direct-send" as const,
          id: `direct:${transfer.id}`,
          transfer,
          sortTime: transfer.blockTime ?? 0,
        })),
      ];

      nextRows.sort((a, b) => b.sortTime - a.sortTime);
      setTransactions(mergedTransactions);
      setRows(nextRows);
      setError(scanError);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [loadVaultEvents, program, vault.address]);

  useEffect(() => {
    setTransactions(loadProposalTransactions());
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
            Vault history
          </p>
          <p className="mt-1 text-sm text-muted">
            Proposal decisions and direct transactions from this vault.
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

      {rows === null ? (
        <div className="text-muted text-sm font-display tracking-wider uppercase">
          Loading history...
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-line-soft p-10 text-center text-sm text-muted">
          No vault history yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const expanded = expandedItem === row.id;

            if (row.kind === "direct-send") {
              const transfer = row.transfer;
              return (
                <div key={row.id} className={historyCardClass(expanded)}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedItem((current) => (current === row.id ? null : row.id))
                    }
                    className="w-full text-left"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
                            Direct send
                          </span>
                          <DirectSendBadge transfer={transfer} vault={vault} />
                        </div>
                        <div className="mt-2 font-display text-xl font-bold text-text">
                          {formatUsdc(transfer.amount)}
                        </div>
                        <div className="mt-1 truncate text-sm text-muted font-display">
                          {shortAddress(transfer.recipient.toBase58(), 6)}
                        </div>
                        <div className="mt-2 truncate text-xs text-accent font-display">
                          Tx {transfer.signature}
                        </div>
                      </div>
                      <div className="text-sm text-muted font-display sm:text-right">
                        {formatUnixDate(transfer.blockTime)}
                        <span className="mt-2 block text-[0.65rem] uppercase tracking-[0.14em]">
                          {expanded ? "Collapse" : "Details"}
                        </span>
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <ExpandedDirectSendDetails transfer={transfer} vault={vault} />
                  )}
                </div>
              );
            }

            const proposal = row.proposal;
            const status = historyStatus(proposal);
            const proposalKey = proposal.pda.toBase58();
            const transaction = transactions[proposalKey];

            return (
              <div key={row.id} className={historyCardClass(expanded)}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedItem((current) => (current === row.id ? null : row.id))
                  }
                  className="w-full text-left"
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
                      {transaction && (
                        <div className="mt-2 truncate text-xs text-accent font-display">
                          Tx {transaction.signature}
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-muted font-display sm:text-right">
                      {formatUnixDate(transaction?.blockTime ?? proposal.proposedAt)}
                      <span className="mt-2 block text-[0.65rem] uppercase tracking-[0.14em]">
                        {expanded ? "Collapse" : "Details"}
                      </span>
                    </div>
                  </div>
                </button>

                {expanded && (
                  <ExpandedProposalDetails
                    proposal={proposal}
                    transaction={transaction}
                    vault={vault}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
