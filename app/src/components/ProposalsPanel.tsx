"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram } from "@/lib/program";
import { NETWORK } from "@/lib/network";
import { saveProposalTransaction } from "@/lib/proposalTransactions";
import { protocolConfigPda } from "@/lib/pdas";
import { formatUsdc, shortAddress } from "@/lib/format";
import type { VaultData } from "./VaultDetail";
import type { ToastNotification } from "./ToastStack";

type Proposal = {
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

type ProtocolConfigView = {
  feeBps: number;
  stakerRewardAta: PublicKey;
  treasuryAta: PublicKey;
};

type ReviewAction = {
  type: "approve" | "cancel";
  proposalKey: string;
};

const LIVE_REFRESH_INTERVAL_MS = 45_000;
const LIVE_REFRESH_DEBOUNCE_MS = 750;

function statusOf(proposal: Proposal): "pending" | "executed" | "cancelled" {
  if (proposal.executed) return "executed";
  if (proposal.cancelled) return "cancelled";
  return "pending";
}

function rawToBigInt(value: BN | bigint | number): bigint {
  return BigInt(value.toString());
}

function calculateFee(amount: BN, feeBps: number): bigint {
  return (rawToBigInt(amount) * BigInt(feeBps)) / BigInt(10_000);
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

function normalizeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeAnchor = error as {
      error?: { errorMessage?: string };
      logs?: string[];
      message?: string;
    };
    const anchorMessage = maybeAnchor.error?.errorMessage;
    if (anchorMessage) return anchorMessage;
    if (maybeAnchor.message?.includes("insufficient funds")) {
      return "The vault does not have enough USDC to cover the request and protocol fee.";
    }
    if (maybeAnchor.message?.includes("User rejected")) {
      return "The wallet rejected the signature request.";
    }
    if (maybeAnchor.message) return maybeAnchor.message;
  }
  return String(error);
}

function StatusBadge({ status }: { status: ReturnType<typeof statusOf> }) {
  const className =
    status === "pending"
      ? "text-accent border-line"
      : status === "executed"
        ? "text-accent-2 border-line-soft"
        : "text-muted border-line-soft";

  return (
    <span
      className={`border px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] font-display ${className}`}
    >
      {status}
    </span>
  );
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "accent" | "warning";
}) {
  const valueColor =
    tone === "accent"
      ? "text-accent-2"
      : tone === "warning"
        ? "text-accent"
        : "text-text";

  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
        {label}
      </div>
      <div className={`min-w-0 break-all text-sm font-display ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="border border-line-soft bg-[rgba(3,17,19,0.72)] px-4 py-3">
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-lg font-bold ${muted ? "text-muted" : "text-text"}`}
      >
        {value}
      </div>
    </div>
  );
}

function AdvancedData({ children }: { children: React.ReactNode }) {
  return (
    <details className="group mt-4 border border-line-soft bg-[rgba(2,10,12,0.45)] px-4">
      <summary className="cursor-pointer list-none py-3 font-display text-[0.65rem] uppercase tracking-[0.18em] text-muted transition-colors hover:text-text">
        Advanced Data
      </summary>
      <div className="border-t border-line-soft pb-1">{children}</div>
    </details>
  );
}

export function ProposalsPanel({
  vault,
  onChange,
  initialProposal,
  onNotify,
  onOpenHistory,
}: {
  vault: VaultData;
  onChange: () => void;
  initialProposal?: string | null;
  onNotify: (toast: Omit<ToastNotification, "id">) => void;
  onOpenHistory: (proposalKey: string) => void;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [protocolConfig, setProtocolConfig] = useState<ProtocolConfigView | null>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint | null>(null);
  const [selectedProposalKey, setSelectedProposalKey] = useState<string | null>(null);
  const [recipientAtaExists, setRecipientAtaExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const appliedInitialProposalRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const liveRefreshTimerRef = useRef<number | null>(null);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const refresh = useCallback(async () => {
    if (!program) return;
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setError(null);
    try {
      const protocolConfigAddress = protocolConfigPda();
      const [accts, cfg, vaultTokenAccount] = await Promise.all([
        program.account.proposal.all([
          { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
        ]),
        program.account.protocolConfig.fetch(protocolConfigAddress),
        getAccount(connection, vault.vaultUsdcAta),
      ]);

      const list: Proposal[] = accts.map((a) => ({
        pda: a.publicKey,
        proposalId: a.account.proposalId,
        recipient: a.account.recipient,
        recipientAta: a.account.recipientAta,
        amount: a.account.amount,
        proposedAt: a.account.proposedAt,
        executed: a.account.executed,
        cancelled: a.account.cancelled,
        memo: a.account.memo,
      }));
      list.sort((a, b) => b.proposalId.cmp(a.proposalId));

      setProposals(list);
      setProtocolConfig({
        feeBps: Number(cfg.feeBps),
        stakerRewardAta: cfg.stakerRewardAta,
        treasuryAta: cfg.treasuryAta,
      });
      setVaultBalance(vaultTokenAccount.amount);
    } catch (error) {
      setError(normalizeError(error));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [connection, program, vault.address, vault.vaultUsdcAta]);

  useEffect(() => {
    refresh();
    const scheduleRefresh = () => {
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
      }
      liveRefreshTimerRef.current = window.setTimeout(() => {
        void refresh();
      }, LIVE_REFRESH_DEBOUNCE_MS);
    };

    const interval = window.setInterval(() => {
      void refresh();
    }, LIVE_REFRESH_INTERVAL_MS);
    const vaultSubscription = connection.onAccountChange(
      vault.address,
      scheduleRefresh,
      "confirmed"
    );
    const vaultUsdcSubscription = connection.onAccountChange(
      vault.vaultUsdcAta,
      scheduleRefresh,
      "confirmed"
    );

    return () => {
      window.clearInterval(interval);
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
      }
      void connection.removeAccountChangeListener(vaultSubscription);
      void connection.removeAccountChangeListener(vaultUsdcSubscription);
    };
  }, [connection, refresh, vault.address, vault.vaultUsdcAta]);

  const visible = useMemo(() => {
    if (!proposals) return [];
    return proposals.filter((proposal) => statusOf(proposal) === "pending");
  }, [proposals]);

  useEffect(() => {
    if (visible.length === 0) {
      setSelectedProposalKey(null);
      return;
    }
    const initialProposalKey = initialProposal ?? null;
    const initialViewKey = initialProposalKey
      ? `${vault.address.toBase58()}:${initialProposalKey}`
      : null;
    if (
      initialProposalKey &&
      initialViewKey &&
      appliedInitialProposalRef.current !== initialViewKey &&
      visible.some((p) => p.pda.toBase58() === initialProposalKey)
    ) {
      appliedInitialProposalRef.current = initialViewKey;
      setSelectedProposalKey(initialProposalKey);
      return;
    }
    if (!selectedProposalKey || !visible.some((p) => p.pda.toBase58() === selectedProposalKey)) {
      setSelectedProposalKey(visible[0].pda.toBase58());
    }
  }, [initialProposal, selectedProposalKey, vault.address, visible]);

  const selectedProposal =
    visible.find((proposal) => proposal.pda.toBase58() === selectedProposalKey) ??
    visible[0] ??
    null;

  useEffect(() => {
    setReviewAction(null);
  }, [selectedProposalKey]);

  const selectedRecipientAtaKey = selectedProposal?.recipientAta.toBase58() ?? null;

  useEffect(() => {
    if (!selectedRecipientAtaKey || !selectedProposal) {
      setRecipientAtaExists(null);
      return;
    }

    let cancelled = false;
    setRecipientAtaExists(null);
    connection
      .getAccountInfo(selectedProposal.recipientAta)
      .then((account) => {
        if (!cancelled) setRecipientAtaExists(Boolean(account));
      })
      .catch(() => {
        if (!cancelled) setRecipientAtaExists(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connection, selectedProposal, selectedRecipientAtaKey]);

  async function approve(proposal: Proposal) {
    if (!program || !protocolConfig) return;
    const proposalKey = proposal.pda.toBase58();
    const queueWillBeCleared = visible.length <= 1;
    setReviewAction(null);
    setBusy(`approve:${proposalKey}`);
    setError(null);
    try {
      const approvedDebit =
        rawToBigInt(proposal.amount) +
        calculateFee(proposal.amount, protocolConfig.feeBps);
      let setupSignature: string | undefined;
      const recipientAtaAccount = await connection.getAccountInfo(proposal.recipientAta);
      if (!recipientAtaAccount) {
        const expectedRecipientAta = getAssociatedTokenAddressSync(
          vault.usdcMint,
          proposal.recipient,
          true
        );
        if (!expectedRecipientAta.equals(proposal.recipientAta)) {
          throw new Error(
            "Recipient token account is missing and is not the expected associated token account."
          );
        }

        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet!.publicKey,
            proposal.recipientAta,
            proposal.recipient,
            vault.usdcMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        const latestBlockhash = await connection.getLatestBlockhash();
        tx.feePayer = wallet!.publicKey;
        tx.recentBlockhash = latestBlockhash.blockhash;
        const signedTx = await wallet!.signTransaction(tx);
        setupSignature = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(
          { signature: setupSignature, ...latestBlockhash },
          "confirmed"
        );
        setRecipientAtaExists(true);
      }

      const protocolConfigAddress = protocolConfigPda();
      const signature = await program.methods
        .approveProposal()
        .accounts({
          human: wallet!.publicKey,
          vault: vault.address,
          proposal: proposal.pda,
          vaultUsdcAta: vault.vaultUsdcAta,
          recipientAta: proposal.recipientAta,
          protocolConfig: protocolConfigAddress,
          stakerRewardAta: protocolConfig.stakerRewardAta,
          treasuryAta: protocolConfig.treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      saveProposalTransaction(proposalKey, {
        action: "approved",
        signature,
        setupSignature,
      });
      onNotify({
        title: "Approval signed",
        message: `Proposal #${proposal.proposalId.toString()} approved for ${formatUsdc(
          proposal.amount
        )}.`,
        actionLabel: "Open in History",
        onActivate: () => onOpenHistory(proposalKey),
      });
      setProposals((current) =>
        current
          ? current.map((item) =>
              item.pda.equals(proposal.pda)
                ? { ...item, executed: true }
                : item
            )
          : current
      );
      setVaultBalance((current) =>
        current === null ? current : current - approvedDebit
      );
      window.setTimeout(() => {
        void refresh();
        onChange();
      }, LIVE_REFRESH_DEBOUNCE_MS);
      if (queueWillBeCleared) {
        onOpenHistory(proposalKey);
      }
    } catch (error) {
      setError(normalizeError(error));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(proposal: Proposal) {
    if (!program) return;
    const proposalKey = proposal.pda.toBase58();
    const queueWillBeCleared = visible.length <= 1;
    setReviewAction(null);
    setBusy(`cancel:${proposalKey}`);
    setError(null);
    try {
      const signature = await program.methods
        .cancelProposal()
        .accounts({
          human: wallet!.publicKey,
          vault: vault.address,
          proposal: proposal.pda,
        })
        .rpc();

      saveProposalTransaction(proposalKey, {
        action: "cancelled",
        signature,
      });
      onNotify({
        title: "Proposal rejected",
        message: `Proposal #${proposal.proposalId.toString()} was rejected.`,
        actionLabel: "Open in History",
        onActivate: () => onOpenHistory(proposalKey),
      });
      setProposals((current) =>
        current
          ? current.map((item) =>
              item.pda.equals(proposal.pda)
                ? { ...item, cancelled: true }
                : item
            )
          : current
      );
      window.setTimeout(() => {
        void refresh();
        onChange();
      }, LIVE_REFRESH_DEBOUNCE_MS);
      if (queueWillBeCleared) {
        onOpenHistory(proposalKey);
      }
    } catch (error) {
      setError(normalizeError(error));
    } finally {
      setBusy(null);
    }
  }

  const pendingCount =
    proposals?.filter((proposal) => statusOf(proposal) === "pending").length ?? 0;
  const selectedStatus = selectedProposal ? statusOf(selectedProposal) : null;
  const feeBps = protocolConfig?.feeBps ?? 0;
  const selectedAmount = selectedProposal ? rawToBigInt(selectedProposal.amount) : null;
  const selectedFee = selectedProposal ? calculateFee(selectedProposal.amount, feeBps) : null;
  const totalDebit =
    selectedAmount !== null && selectedFee !== null ? selectedAmount + selectedFee : null;
  const projectedBalance =
    vaultBalance !== null && totalDebit !== null ? vaultBalance - totalDebit : null;
  const displayedBalance =
    selectedStatus === "pending" ? projectedBalance : vaultBalance;
  const hasInsufficientFunds =
    selectedStatus === "pending" &&
    projectedBalance !== null &&
    projectedBalance < BigInt(0);
  const isHumanWallet = wallet?.publicKey.equals(vault.human) ?? false;
  const expectedRecipientAta = selectedProposal
    ? getAssociatedTokenAddressSync(vault.usdcMint, selectedProposal.recipient, true)
    : null;
  const recipientAtaMatches = selectedProposal
    ? expectedRecipientAta?.equals(selectedProposal.recipientAta) ?? false
    : true;

  const approveBlockedReason =
    !protocolConfig
      ? "Protocol configuration is still loading."
      : vaultBalance === null
        ? "Vault balance is still loading."
        : !isHumanWallet
      ? "Connect the human owner wallet to approve."
      : vault.paused
        ? "Unpause agent access before approving."
        : hasInsufficientFunds
          ? "Vault balance is too low for the amount plus protocol fee."
          : !recipientAtaMatches
            ? "Recipient token account does not match the expected USDC account."
            : null;

  return (
    <div className="space-y-5">
      <div className="brackets p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
              Human review queue
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <h2 className="font-display text-2xl font-bold text-text">
                {pendingCount} pending
              </h2>
              <span className="text-sm text-muted">
                Vault balance {vaultBalance === null ? "..." : formatUsdc(vaultBalance)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={refresh}
              className="border border-line-soft px-3 py-2 text-xs uppercase tracking-wider font-display text-muted hover:border-line hover:text-text"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
          {error}
        </div>
      )}

      {proposals === null ? (
        <div className="text-muted text-sm font-display tracking-wider uppercase">
          Loading proposals...
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-dashed border-line-soft p-10 text-center text-sm text-muted">
          No proposals waiting for approval.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <div className="space-y-2">
            {visible.map((proposal) => {
              const proposalKey = proposal.pda.toBase58();
              const status = statusOf(proposal);
              const selected = selectedProposal?.pda.equals(proposal.pda) ?? false;
              return (
                <button
                  key={proposalKey}
                  type="button"
                  onClick={() => setSelectedProposalKey(proposalKey)}
                  className={`w-full border p-4 text-left transition-colors ${
                    selected
                      ? "border-line bg-[rgba(10,186,181,0.08)]"
                      : "border-line-soft bg-[rgba(3,17,19,0.68)] hover:border-line"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
                        Proposal #{proposal.proposalId.toString()}
                      </div>
                      <div className="mt-1 font-display text-xl font-bold text-text">
                        {formatUsdc(proposal.amount)}
                      </div>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <div className="mt-3 truncate text-sm text-muted font-display">
                    {shortAddress(proposal.recipient.toBase58(), 6)}
                  </div>
                  {proposal.memo && (
                    <div className="mt-2 line-clamp-2 text-sm text-muted">
                      {proposal.memo}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selectedProposal && (
            <div className="brackets p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
                    Review request
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <h3 className="font-display text-3xl font-bold text-text">
                      {formatUsdc(selectedProposal.amount)}
                    </h3>
                    {selectedStatus && <StatusBadge status={selectedStatus} />}
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
                    Proposed
                  </div>
                  <div className="mt-1 text-sm text-text font-display">
                    {formatDate(selectedProposal.proposedAt)}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Recipient gets" value={formatUsdc(selectedProposal.amount)} />
                <Metric
                  label="Protocol fee"
                  value={selectedFee === null ? "..." : formatUsdc(selectedFee)}
                  muted={selectedFee === BigInt(0)}
                />
                <Metric
                  label="Vault debit"
                  value={totalDebit === null ? "..." : formatUsdc(totalDebit)}
                />
                <Metric
                  label={selectedStatus === "pending" ? "After approval" : "Vault balance"}
                  value={displayedBalance === null ? "..." : formatUsdc(displayedBalance)}
                  muted={hasInsufficientFunds}
                />
              </div>

              <div className="mt-5 border-y border-line-soft">
                <DetailRow
                  label="Recipient"
                  value={selectedProposal.recipient.toBase58()}
                />
                <DetailRow
                  label="Memo"
                  value={selectedProposal.memo || "No memo supplied"}
                />
              </div>

              <AdvancedData>
                <DetailRow
                  label="Proposal PDA"
                  value={selectedProposal.pda.toBase58()}
                />
                <DetailRow
                  label="Recipient USDC"
                  value={selectedProposal.recipientAta.toBase58()}
                />
                <DetailRow label="Agent" value={vault.agent.toBase58()} />
                <DetailRow label="Vault" value={vault.address.toBase58()} />
                <DetailRow label="USDC mint" value={vault.usdcMint.toBase58()} />
                <DetailRow
                  label="Readiness"
                  value={
                    !recipientAtaMatches
                      ? "Recipient token account mismatch"
                      : recipientAtaExists === null
                        ? "Checking recipient token account..."
                        : recipientAtaExists
                          ? "Recipient token account exists"
                          : "Recipient token account will be created before approval"
                  }
                  tone={!recipientAtaMatches ? "warning" : "accent"}
                />
              </AdvancedData>

              {selectedStatus === "pending" && (
                <div className="mt-5">
                  {approveBlockedReason && (
                    <div className="mb-3 border border-line-soft bg-[rgba(10,186,181,0.04)] p-3 text-sm text-muted">
                      {approveBlockedReason}
                    </div>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() =>
                        setReviewAction({
                          type: "approve",
                          proposalKey: selectedProposal.pda.toBase58(),
                        })
                      }
                      disabled={
                        Boolean(approveBlockedReason) ||
                        busy === `approve:${selectedProposal.pda.toBase58()}`
                      }
                      className="brackets-accent px-5 py-3 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
                    >
                      {busy === `approve:${selectedProposal.pda.toBase58()}`
                        ? "Signing..."
                        : "Approve"}
                    </button>
                    <button
                      onClick={() =>
                        setReviewAction({
                          type: "cancel",
                          proposalKey: selectedProposal.pda.toBase58(),
                        })
                      }
                      disabled={busy === `cancel:${selectedProposal.pda.toBase58()}`}
                      className="border border-line-soft px-5 py-3 text-xs font-display font-bold uppercase tracking-[0.14em] text-text hover:border-line disabled:opacity-50"
                    >
                      {busy === `cancel:${selectedProposal.pda.toBase58()}`
                        ? "Cancelling..."
                        : "Cancel request"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {reviewAction &&
        selectedProposal &&
        selectedProposal.pda.toBase58() === reviewAction.proposalKey && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="brackets max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
              <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-accent-2">
                Final signing review
              </p>
              <h2 className="font-display text-2xl font-bold text-text">
                {reviewAction.type === "approve"
                  ? "Approve this transaction"
                  : "Reject this request"}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {reviewAction.type === "approve"
                  ? "Your wallet signature will execute this proposal and move USDC from the vault."
                  : "Your wallet signature will cancel this proposal. No USDC will move."}
              </p>

              <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Recipient gets" value={formatUsdc(selectedProposal.amount)} />
                <Metric
                  label="Protocol fee"
                  value={selectedFee === null ? "..." : formatUsdc(selectedFee)}
                  muted={selectedFee === BigInt(0)}
                />
                <Metric
                  label="Vault debit"
                  value={
                    reviewAction.type === "approve" && totalDebit !== null
                      ? formatUsdc(totalDebit)
                      : "0.00 USDC"
                  }
                  muted={reviewAction.type === "cancel"}
                />
                <Metric
                  label="After signature"
                  value={
                    reviewAction.type === "approve" && projectedBalance !== null
                      ? formatUsdc(projectedBalance)
                      : vaultBalance === null
                        ? "..."
                        : formatUsdc(vaultBalance)
                  }
                  muted={hasInsufficientFunds}
                />
              </div>

              <div className="mt-5 border-y border-line-soft">
                <DetailRow
                  label="Proposal"
                  value={`#${selectedProposal.proposalId.toString()}`}
                />
                <DetailRow
                  label="Recipient"
                  value={selectedProposal.recipient.toBase58()}
                />
                <DetailRow
                  label="Memo"
                  value={selectedProposal.memo || "No memo supplied"}
                />
              </div>

              <AdvancedData>
                <DetailRow label="Network" value={NETWORK} />
                <DetailRow
                  label="Proposal PDA"
                  value={selectedProposal.pda.toBase58()}
                />
                <DetailRow label="Vault" value={vault.address.toBase58()} />
                <DetailRow
                  label="Human signer"
                  value={wallet?.publicKey.toBase58() ?? ""}
                />
                <DetailRow label="Agent" value={vault.agent.toBase58()} />
                <DetailRow
                  label="Recipient USDC"
                  value={selectedProposal.recipientAta.toBase58()}
                />
                {reviewAction.type === "approve" && protocolConfig && (
                  <>
                    <DetailRow
                      label="Treasury USDC"
                      value={protocolConfig.treasuryAta.toBase58()}
                    />
                    <DetailRow
                      label="Staker rewards USDC"
                      value={protocolConfig.stakerRewardAta.toBase58()}
                    />
                  </>
                )}
              </AdvancedData>

              {reviewAction.type === "approve" && approveBlockedReason && (
                <div className="mt-4 border border-line-soft bg-[rgba(10,186,181,0.04)] p-3 text-sm text-muted">
                  {approveBlockedReason}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setReviewAction(null)}
                  className="border border-line-soft px-4 py-2 text-sm font-display uppercase tracking-[0.14em] text-muted hover:text-text"
                >
                  Review later
                </button>
                {reviewAction.type === "approve" ? (
                  <button
                    type="button"
                    onClick={() => approve(selectedProposal)}
                    disabled={Boolean(approveBlockedReason)}
                    className="brackets-accent px-4 py-2 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
                  >
                    Sign approval
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => cancel(selectedProposal)}
                    className="border border-line-soft px-4 py-2 text-sm font-display font-bold uppercase tracking-[0.14em] text-text hover:border-line"
                  >
                    Sign rejection
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
