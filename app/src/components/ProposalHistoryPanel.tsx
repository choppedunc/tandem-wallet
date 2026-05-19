"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const TX_HISTORY_CACHE_MS = 30_000;

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
  fee?: BN;
};

type ChainEventHistory = {
  directSends: DirectSendHistoryItem[];
  proposalTransactions: Record<string, HistoryProposalTransaction>;
  incomplete: boolean;
};

type ChainHistoryPayload = {
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
  proposalTransactions?: Record<
    string,
    ProposalTransactionRecord & {
      blockTime?: number | null;
      slot?: number;
      fee?: string;
    }
  >;
  incomplete?: boolean;
  error?: string;
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
type HistoryFilter = "all" | "allowance" | "approved" | "rejected" | "whitelist";

const HISTORY_FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "allowance", label: "Allowance" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "whitelist", label: "Whitelist" },
];

const chainHistoryCache = new Map<
  string,
  { loadedAt: number; history: ChainEventHistory }
>();
const chainHistoryInFlight = new Map<string, Promise<ChainEventHistory>>();

function historyStatus(
  proposal: ProposalHistoryItem,
  transaction?: HistoryProposalTransaction
): "accepted" | "rejected" | "pending" {
  if (transaction?.action === "approved") return "accepted";
  if (transaction?.action === "cancelled") return "rejected";
  if (proposal.executed) return "accepted";
  if (proposal.cancelled) return "rejected";
  return "pending";
}

function proposalIsFinal(
  proposal: ProposalHistoryItem,
  transaction?: HistoryProposalTransaction
): boolean {
  return historyStatus(proposal, transaction) !== "pending";
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
    if (maybeError.message?.includes("429")) {
      return "Direct transaction history is temporarily rate-limited by devnet RPC.";
    }
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
      fee: chain[proposal]?.fee,
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

function rowMatchesFilter(
  row: HistoryRow,
  filter: HistoryFilter,
  transactions: Record<string, HistoryProposalTransaction>,
  vault: VaultData
): boolean {
  if (filter === "all") return true;

  if (row.kind === "direct-send") {
    if (filter === "whitelist") return row.transfer.whitelisted;
    if (filter === "allowance") {
      return row.transfer.signer.equals(vault.agent) && !row.transfer.whitelisted;
    }
    return false;
  }

  if (filter === "approved" || filter === "rejected") {
    const status = historyStatus(
      row.proposal,
      transactions[row.proposal.pda.toBase58()]
    );
    return filter === "approved" ? status === "accepted" : status === "rejected";
  }

  return false;
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

function toggleOnActivationKey(
  event: React.KeyboardEvent<HTMLElement>,
  onToggle: () => void
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onToggle();
}

function TransactionLink({
  signature,
  children,
  className,
  stopPropagation,
}: {
  signature: string;
  children?: React.ReactNode;
  className?: string;
  stopPropagation?: boolean;
}) {
  return (
    <a
      href={explorerTxUrl(signature)}
      target="_blank"
      rel="noreferrer"
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      className={
        className ??
        "text-accent hover:text-text underline underline-offset-4"
      }
    >
      {children ?? signature}
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
  const status = historyStatus(proposal, transaction);

  return (
    <div className="mt-4 border-t border-line-soft pt-4">
      <div className="border-y border-line-soft">
        <DetailRow label="Proposal ID" value={proposal.proposalId.toString()} />
        <DetailRow label="Proposal PDA" value={proposal.pda.toBase58()} />
        <DetailRow label="Status" value={status} />
        <DetailRow label="Amount" value={formatUsdc(proposal.amount)} />
        {transaction?.fee !== undefined && (
          <DetailRow label="Protocol fee" value={formatUsdc(transaction.fee)} />
        )}
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

export function ProposalHistoryPanel({
  vault,
  focusedProposal,
  refreshKey = 0,
}: {
  vault: VaultData;
  focusedProposal?: string | null;
  refreshKey?: number;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [transactions, setTransactions] = useState<Record<string, HistoryProposalTransaction>>({});
  const [error, setError] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const appliedFocusedProposalRef = useRef<string | null>(null);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const loadVaultEvents = useCallback(async (forceFresh = false): Promise<ChainEventHistory> => {
    if (!program) return { directSends: [], proposalTransactions: {}, incomplete: false };

    const cacheKey = vault.address.toBase58();
    const cached = chainHistoryCache.get(cacheKey);
    if (!forceFresh && cached && Date.now() - cached.loadedAt < TX_HISTORY_CACHE_MS) {
      return cached.history;
    }

    const inFlightKey = forceFresh ? `${cacheKey}:fresh` : cacheKey;
    const inFlight = chainHistoryInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const freshness = forceFresh ? "&fresh=1" : "";
      const response = await fetch(
        `/api/vault-history?vault=${cacheKey}${freshness}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error("Direct transaction history could not be loaded.");
      }
      const payload = (await response.json()) as ChainHistoryPayload;
      if (payload.error) throw new Error(payload.error);

      const history: ChainEventHistory = {
        directSends: payload.directSends.map((transfer) => ({
          id: transfer.id,
          signature: transfer.signature,
          slot: transfer.slot,
          blockTime: transfer.blockTime,
          signer: asPublicKey(transfer.signer),
          recipient: asPublicKey(transfer.recipient),
          amount: asBn(transfer.amount),
          fee: asBn(transfer.fee),
          whitelisted: Boolean(transfer.whitelisted),
        })),
        proposalTransactions: Object.fromEntries(
          Object.entries(payload.proposalTransactions ?? {}).map(([proposal, record]) => [
            proposal,
            {
              ...record,
              fee: record.fee !== undefined ? asBn(record.fee) : undefined,
            },
          ])
        ),
        incomplete: Boolean(payload.incomplete),
      };
      chainHistoryCache.set(cacheKey, { loadedAt: Date.now(), history });
      return history;
    })();

    chainHistoryInFlight.set(inFlightKey, request);
    try {
      return await request;
    } finally {
      chainHistoryInFlight.delete(inFlightKey);
    }
  }, [program, vault.address]);

  const refresh = useCallback(async () => {
    if (!program) return;

    const localTransactions = loadProposalTransactions();
    setTransactions(localTransactions);
    setError(null);
    setScanWarning(null);

    try {
      const accounts = await program.account.proposal.all([
        { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
      ]);
      const mapped: ProposalHistoryItem[] = accounts.map((account) => ({
        pda: account.publicKey,
        proposalId: account.account.proposalId,
        recipient: account.account.recipient,
        recipientAta: account.account.recipientAta,
        amount: account.account.amount,
        proposedAt: account.account.proposedAt,
        executed: account.account.executed,
        cancelled: account.account.cancelled,
        memo: account.account.memo,
      }));
      const proposalRows: HistoryRow[] = mapped
        .filter((proposal) =>
          proposalIsFinal(proposal, localTransactions[proposal.pda.toBase58()])
        )
        .map((proposal) => {
          const proposalKey = proposal.pda.toBase58();
          return {
            kind: "proposal" as const,
            id: proposalKey,
            proposal,
            sortTime: proposalSortTime(proposal, localTransactions[proposalKey]),
          };
        })
        .sort((a, b) => b.sortTime - a.sortTime);

      setRows(proposalRows);

      let chainHistory: ChainEventHistory = {
        directSends: [],
        proposalTransactions: {},
        incomplete: false,
      };

      try {
        chainHistory = await loadVaultEvents(true);
      } catch (eventError) {
        setScanWarning(normalizeError(eventError));
        return;
      }

      const mergedTransactions = mergeTransactionRecords(
        localTransactions,
        chainHistory.proposalTransactions
      );
      const nextRows: HistoryRow[] = [
        ...mapped
          .filter((proposal) =>
            proposalIsFinal(proposal, mergedTransactions[proposal.pda.toBase58()])
          )
          .map((proposal) => {
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
      setScanWarning(
        chainHistory.incomplete
          ? "Some recent direct transactions could not be checked because devnet RPC is rate-limiting transaction lookups."
          : null
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [loadVaultEvents, program, vault.address]);

  useEffect(() => {
    setTransactions(loadProposalTransactions());
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!focusedProposal || !rows) return;
    if (
      !rows.some(
        (row) => row.kind === "proposal" && row.proposal.pda.toBase58() === focusedProposal
      )
    ) {
      return;
    }

    const focusKey = `${vault.address.toBase58()}:${focusedProposal}`;
    if (appliedFocusedProposalRef.current === focusKey) return;
    appliedFocusedProposalRef.current = focusKey;
    window.requestAnimationFrame(() => {
      document
        .getElementById(`history-${focusedProposal}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [focusedProposal, rows, vault.address]);

  const filteredRows = useMemo(
    () =>
      rows?.filter((row) => rowMatchesFilter(row, filter, transactions, vault)) ??
      null,
    [filter, rows, transactions, vault]
  );
  const noHistoryRows = rows?.length === 0;

  useEffect(() => {
    if (!expandedItem || !filteredRows) return;
    if (filteredRows.some((row) => row.id === expandedItem)) return;
    setExpandedItem(null);
  }, [expandedItem, filteredRows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
            Vault history
          </p>
          <p className="mt-1 text-sm text-muted">
            Proposal decisions and direct transactions from this vault.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex flex-wrap gap-1">
            {HISTORY_FILTERS.map((option) => {
              const active = filter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={`border px-3 py-2 text-xs uppercase tracking-wider font-display transition-colors ${
                    active
                      ? "border-line bg-[rgba(10,186,181,0.1)] text-text"
                      : "border-line-soft text-muted hover:border-line hover:text-text"
                  }`}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={refresh}
            className="border border-line-soft px-3 py-2 text-xs uppercase tracking-wider font-display text-muted hover:border-line hover:text-text"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
          {error}
        </div>
      )}

      {scanWarning && (
        <div className="border border-line-soft bg-[rgba(3,17,19,0.72)] p-3 text-xs text-muted">
          {scanWarning}
        </div>
      )}

      {filteredRows === null ? (
        <div className="text-muted text-sm font-display tracking-wider uppercase">
          Loading history...
        </div>
      ) : noHistoryRows ? (
        <div className="border border-dashed border-line-soft p-10 text-center text-sm text-muted">
          No vault history yet.
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="border border-dashed border-line-soft p-10 text-center text-sm text-muted">
          No matching history.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRows.map((row) => {
            const expanded = expandedItem === row.id;
            const toggleExpanded = () =>
              setExpandedItem((current) => (current === row.id ? null : row.id));

            if (row.kind === "direct-send") {
              const transfer = row.transfer;
              return (
                <div key={row.id} className={historyCardClass(expanded)}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={toggleExpanded}
                    onKeyDown={(event) => toggleOnActivationKey(event, toggleExpanded)}
                    className="w-full cursor-pointer text-left"
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
                        <div className="mt-2 text-sm text-muted">
                          Send {formatUsdc(transfer.amount)} to{" "}
                          {shortAddress(transfer.recipient.toBase58(), 6)}
                        </div>
                        <TransactionLink
                          signature={transfer.signature}
                          stopPropagation
                          className="mt-2 block truncate text-xs text-accent font-display hover:text-text underline underline-offset-4"
                        >
                          Tx {transfer.signature}
                        </TransactionLink>
                      </div>
                      <div className="text-sm text-muted font-display sm:text-right">
                        {formatUnixDate(transfer.blockTime)}
                        <span className="mt-2 block text-[0.65rem] uppercase tracking-[0.14em]">
                          {expanded ? "Collapse" : "Details"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <ExpandedDirectSendDetails transfer={transfer} vault={vault} />
                  )}
                </div>
              );
            }

            const proposal = row.proposal;
            const proposalKey = proposal.pda.toBase58();
            const transaction = transactions[proposalKey];
            const status = historyStatus(proposal, transaction);

            return (
              <div
                key={row.id}
                id={`history-${proposalKey}`}
                className={historyCardClass(expanded)}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={toggleExpanded}
                  onKeyDown={(event) => toggleOnActivationKey(event, toggleExpanded)}
                  className="w-full cursor-pointer text-left"
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
                        <TransactionLink
                          signature={transaction.signature}
                          stopPropagation
                          className="mt-2 block truncate text-xs text-accent font-display hover:text-text underline underline-offset-4"
                        >
                          Tx {transaction.signature}
                        </TransactionLink>
                      )}
                    </div>
                    <div className="text-sm text-muted font-display sm:text-right">
                      {formatUnixDate(transaction?.blockTime ?? proposal.proposedAt)}
                      <span className="mt-2 block text-[0.65rem] uppercase tracking-[0.14em]">
                        {expanded ? "Collapse" : "Details"}
                      </span>
                    </div>
                  </div>
                </div>

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
