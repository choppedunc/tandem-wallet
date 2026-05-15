"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  formatUsdc,
  formatSol,
  rawToUsdc,
  shortAddress,
  usdcToRaw,
} from "@/lib/format";
import { getProgram } from "@/lib/program";
import { VaultOverview } from "./VaultOverview";
import { ProposalHistoryPanel } from "./ProposalHistoryPanel";
import { ProposalsPanel } from "./ProposalsPanel";
import { WhitelistPanel } from "./WhitelistPanel";
import { AgentConnectorPanel } from "./AgentConnectorPanel";

export type VaultData = {
  address: PublicKey;
  human: PublicKey;
  agent: PublicKey;
  usdcMint: PublicKey;
  vaultUsdcAta: PublicKey;
  spendingLimit: BN;
  paused: boolean;
  proposalCount: BN;
};

export type VaultTab =
  | "overview"
  | "proposals"
  | "history"
  | "whitelist"
  | "agent";
const LIVE_REFRESH_INTERVAL_MS = 45_000;
const LIVE_REFRESH_DEBOUNCE_MS = 750;

type ActionModal = "usdc" | "sol" | "limit" | null;

function normalizeActionError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as {
      error?: { errorMessage?: string };
      message?: string;
    };
    if (maybeError.error?.errorMessage) return maybeError.error.errorMessage;
    if (maybeError.message?.includes("User rejected")) {
      return "The wallet rejected the signature request.";
    }
    if (maybeError.message) return maybeError.message;
  }
  return String(error);
}

function shortSignature(signature: string): string {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 border border-line-soft px-3 py-2 text-[0.65rem] uppercase tracking-[0.14em] text-accent-2 transition-colors hover:border-line hover:text-text"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function ActionModalShell({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onMouseDown={onClose}
    >
      <div
        className="brackets max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-accent-2">
              {eyebrow}
            </p>
            <h2 className="font-display text-2xl font-bold text-text">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-line-soft px-3 py-2 text-xs font-display uppercase tracking-[0.14em] text-muted hover:border-line hover:text-text"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <div className="border border-line-soft px-4 py-3 bg-[rgba(3,17,19,0.7)]">
      <div className="mb-2 flex min-h-8 items-start justify-between gap-3">
        <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
          {label}
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            className="shrink-0 border border-line-soft px-2.5 py-1 text-[0.6rem] font-display uppercase tracking-[0.14em] text-accent-2 transition-colors hover:border-line hover:text-text disabled:opacity-50"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      <div className={`font-display text-base ${accent ?? "text-text"}`}>
        {value}
      </div>
    </div>
  );
}

export function VaultDetail({
  vault,
  vaultName,
  onChange,
  initialTab,
  initialProposal,
}: {
  vault: VaultData;
  vaultName?: string;
  onChange: () => void;
  initialTab?: VaultTab;
  initialProposal?: string | null;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [tab, setTab] = useState<VaultTab>("overview");
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [agentSolBalance, setAgentSolBalance] = useState<number | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [usdcTopUpAmount, setUsdcTopUpAmount] = useState("");
  const [solTopUpAmount, setSolTopUpAmount] = useState("");
  const [limitInput, setLimitInput] = useState(
    rawToUsdc(vault.spendingLimit).toString()
  );
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const appliedInitialViewRef = useRef<string | null>(null);
  const balancesRefreshInFlightRef = useRef(false);
  const pendingRefreshInFlightRef = useRef(false);
  const liveRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!initialTab) return;
    const key = `${vault.address.toBase58()}:${initialTab}:${
      initialProposal ?? ""
    }`;
    if (appliedInitialViewRef.current === key) return;
    appliedInitialViewRef.current = key;
    setTab(initialTab);
  }, [initialProposal, initialTab, vault.address]);

  useEffect(() => {
    setLimitInput(rawToUsdc(vault.spendingLimit).toString());
  }, [vault.address, vault.spendingLimit]);

  const refreshBalances = useCallback(async () => {
    if (balancesRefreshInFlightRef.current) return;
    balancesRefreshInFlightRef.current = true;
    try {
      const [acct, agentSol] = await Promise.all([
        getAccount(connection, vault.vaultUsdcAta),
        connection.getBalance(vault.agent),
      ]);
      setUsdcBalance(acct.amount);
      setAgentSolBalance(agentSol);
    } catch {
      setUsdcBalance(BigInt(0));
      setAgentSolBalance(0);
    } finally {
      balancesRefreshInFlightRef.current = false;
    }
  }, [connection, vault.agent, vault.vaultUsdcAta]);

  const refreshPendingProposalCount = useCallback(async () => {
    if (!wallet) return;
    if (pendingRefreshInFlightRef.current) return;
    pendingRefreshInFlightRef.current = true;
    try {
      const program = getProgram(connection, wallet);
      const accounts = await program.account.proposal.all([
        { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
      ]);
      setPendingProposalCount(
        accounts.filter(
          (account) => !account.account.executed && !account.account.cancelled
        ).length
      );
    } catch {
      setPendingProposalCount(0);
    } finally {
      pendingRefreshInFlightRef.current = false;
    }
  }, [connection, vault.address, wallet]);

  useEffect(() => {
    refreshBalances();
    refreshPendingProposalCount();
  }, [refreshBalances, refreshPendingProposalCount]);

  useEffect(() => {
    let cancelled = false;

    const refreshLiveState = () => {
      if (cancelled) return;
      void refreshBalances();
      void refreshPendingProposalCount();
    };
    const scheduleLiveStateRefresh = () => {
      if (cancelled) return;
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
      }
      liveRefreshTimerRef.current = window.setTimeout(
        refreshLiveState,
        LIVE_REFRESH_DEBOUNCE_MS
      );
    };

    const vaultSubscription = connection.onAccountChange(
      vault.address,
      () => {
        scheduleLiveStateRefresh();
        onChange();
      },
      "confirmed"
    );
    const vaultUsdcSubscription = connection.onAccountChange(
      vault.vaultUsdcAta,
      scheduleLiveStateRefresh,
      "confirmed"
    );
    const agentSubscription = connection.onAccountChange(
      vault.agent,
      scheduleLiveStateRefresh,
      "confirmed"
    );
    const interval = window.setInterval(
      refreshLiveState,
      LIVE_REFRESH_INTERVAL_MS
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
      }
      void connection.removeAccountChangeListener(vaultSubscription);
      void connection.removeAccountChangeListener(vaultUsdcSubscription);
      void connection.removeAccountChangeListener(agentSubscription);
    };
  }, [
    connection,
    onChange,
    refreshBalances,
    refreshPendingProposalCount,
    vault.agent,
    vault.address,
    vault.vaultUsdcAta,
  ]);

  const handleChange = useCallback(() => {
    refreshPendingProposalCount();
    onChange();
  }, [onChange, refreshPendingProposalCount]);

  function openActionModal(modal: Exclude<ActionModal, null>) {
    setActionError(null);
    setActionSuccess(null);
    setActionModal(modal);
  }

  function closeActionModal() {
    if (actionBusy) return;
    setActionModal(null);
    setActionError(null);
    setActionSuccess(null);
  }

  async function depositUsdc(event: React.FormEvent) {
    event.preventDefault();
    if (!wallet) return;
    setActionBusy("usdc");
    setActionError(null);
    setActionSuccess(null);

    try {
      const amountNumber = Number(usdcTopUpAmount);
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        throw new Error("Enter a USDC amount greater than zero.");
      }

      const amountRaw = usdcToRaw(amountNumber);
      const amountRawBigInt = BigInt(amountRaw.toString());
      const sourceAta = getAssociatedTokenAddressSync(
        vault.usdcMint,
        wallet.publicKey
      );
      let sourceAccount;
      try {
        sourceAccount = await getAccount(connection, sourceAta);
      } catch {
        throw new Error(
          "Connected wallet does not have a USDC token account for this mint."
        );
      }
      if (sourceAccount.amount < amountRawBigInt) {
        throw new Error(
          `Connected wallet only has ${formatUsdc(sourceAccount.amount)} available.`
        );
      }

      const transaction = new Transaction().add(
        createTransferInstruction(
          sourceAta,
          vault.vaultUsdcAta,
          wallet.publicKey,
          amountRawBigInt,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      const latestBlockhash = await connection.getLatestBlockhash();
      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const signedTransaction = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize()
      );
      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        "confirmed"
      );

      setUsdcTopUpAmount("");
      setUsdcBalance((current) =>
        current === null ? current : current + amountRawBigInt
      );
      setActionSuccess(
        `${formatUsdc(amountRawBigInt)} deposited. Tx: ${shortSignature(
          signature
        )}`
      );
      window.setTimeout(() => {
        void refreshBalances();
        onChange();
      }, LIVE_REFRESH_DEBOUNCE_MS);
    } catch (error) {
      setActionError(normalizeActionError(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function topUpAgentSol(event: React.FormEvent) {
    event.preventDefault();
    if (!wallet) return;
    setActionBusy("sol");
    setActionError(null);
    setActionSuccess(null);

    try {
      const amountNumber = Number(solTopUpAmount);
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        throw new Error("Enter a SOL amount greater than zero.");
      }
      const lamports = Math.round(amountNumber * LAMPORTS_PER_SOL);
      if (lamports <= 0) {
        throw new Error("SOL amount is too small.");
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: vault.agent,
          lamports,
        })
      );
      const latestBlockhash = await connection.getLatestBlockhash();
      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const signedTransaction = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize()
      );
      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        "confirmed"
      );

      setSolTopUpAmount("");
      setAgentSolBalance((current) =>
        current === null ? current : current + lamports
      );
      setActionSuccess(
        `${formatSol(lamports)} sent to the agent wallet. Tx: ${shortSignature(
          signature
        )}`
      );
      window.setTimeout(() => {
        void refreshBalances();
        onChange();
      }, LIVE_REFRESH_DEBOUNCE_MS);
    } catch (error) {
      setActionError(normalizeActionError(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function updateLimit(event: React.FormEvent) {
    event.preventDefault();
    if (!wallet) return;
    setActionBusy("limit");
    setActionError(null);
    setActionSuccess(null);

    try {
      if (!wallet.publicKey.equals(vault.human)) {
        throw new Error("Only the human owner can edit this vault.");
      }
      const limitNumber = Number(limitInput);
      if (!Number.isFinite(limitNumber) || limitNumber < 0) {
        throw new Error("Limit must be 0 or greater.");
      }

      const program = getProgram(connection, wallet);
      await program.methods
        .setLimit(usdcToRaw(limitNumber))
        .accounts({ human: wallet.publicKey, vault: vault.address })
        .rpc();

      setActionSuccess(`Allowance updated to ${limitNumber} USDC.`);
      onChange();
      window.setTimeout(closeActionModal, 900);
    } catch (error) {
      setActionError(normalizeActionError(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function togglePause() {
    if (!wallet) return;
    setStatusBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      if (!wallet.publicKey.equals(vault.human)) {
        throw new Error("Only the human owner can edit this vault.");
      }
      const program = getProgram(connection, wallet);
      const method = vault.paused ? "unpause" : "pause";
      await program.methods
        [method]()
        .accounts({ human: wallet.publicKey, vault: vault.address })
        .rpc();
      onChange();
    } catch (error) {
      setActionError(normalizeActionError(error));
    } finally {
      setStatusBusy(false);
    }
  }

  const tabs: { id: VaultTab; label: string; badge?: number }[] = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      { id: "proposals", label: "Proposals", badge: pendingProposalCount },
      { id: "history", label: "History" },
      { id: "whitelist", label: "Whitelist" },
      { id: "agent", label: "Agent" },
    ],
    [pendingProposalCount]
  );

  return (
    <div>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-display mb-2">
          Vault
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-text">
            {vaultName ?? shortAddress(vault.address.toBase58(), 6)}
          </h1>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label="USDC"
            value={usdcBalance === null ? "…" : formatUsdc(Number(usdcBalance))}
            actionLabel="Top up"
            onAction={() => openActionModal("usdc")}
          />
          <Stat
            label="Agent SOL"
            value={agentSolBalance === null ? "…" : formatSol(agentSolBalance)}
            actionLabel="Top up"
            onAction={() => openActionModal("sol")}
          />
          <Stat
            label="Limit"
            value={formatUsdc(vault.spendingLimit)}
            actionLabel="Edit"
            onAction={() => openActionModal("limit")}
          />
          <Stat
            label="Status"
            value={vault.paused ? "Agent paused" : "Active"}
            accent={vault.paused ? "text-accent-2" : "text-accent"}
            actionLabel={
              statusBusy ? "Working" : vault.paused ? "Resume" : "Pause"
            }
            actionDisabled={statusBusy}
            onAction={togglePause}
          />
        </div>

        {actionError && !actionModal ? (
          <div className="mt-3 border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
            {actionError}
          </div>
        ) : null}
      </div>

      <div className="border-b border-line-soft mb-8">
        <nav className="flex flex-wrap gap-1 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-display uppercase tracking-[0.14em] border-b-2 transition-colors ${
                tab === t.id
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              <span>{t.label}</span>
              {t.badge ? (
                <span className="inline-flex items-center gap-1.5 text-accent-2">
                  <span
                    aria-hidden="true"
                    className="relative flex h-2.5 w-2.5"
                  >
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d45f67] opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#d45f67] shadow-[0_0_10px_rgba(212,95,103,0.45)]" />
                  </span>
                  <span>({t.badge})</span>
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && (
        <VaultOverview
          vault={vault}
          usdcBalance={usdcBalance}
          onChange={handleChange}
        />
      )}
      {tab === "proposals" && (
        <ProposalsPanel
          vault={vault}
          onChange={handleChange}
          initialProposal={initialProposal}
        />
      )}
      {tab === "history" && <ProposalHistoryPanel vault={vault} />}
      {tab === "whitelist" && <WhitelistPanel vault={vault} />}
      {tab === "agent" && <AgentConnectorPanel vault={vault} />}

      {actionModal === "usdc" && (
        <ActionModalShell
          eyebrow="Top up USDC"
          title="Deposit USDC into this vault"
          onClose={closeActionModal}
        >
          <p className="mb-5 text-sm leading-relaxed text-muted">
            Send devnet USDC to the vault token account, or deposit directly
            from your connected wallet.
          </p>
          <div className="mb-5">
            <p className="mb-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
              USDC deposit account
            </p>
            <div className="flex min-w-0 flex-col gap-3 border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all font-display text-sm text-text">
                {vault.vaultUsdcAta.toBase58()}
              </code>
              <CopyButton value={vault.vaultUsdcAta.toBase58()} label="Copy" />
            </div>
          </div>
          <form onSubmit={depositUsdc} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-2 block text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
                Amount
              </span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={usdcTopUpAmount}
                  onChange={(event) => setUsdcTopUpAmount(event.target.value)}
                  className="w-full border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-2.5 pr-16 font-display text-sm text-text focus:outline-none focus:border-line"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] uppercase tracking-[0.12em] text-muted font-display">
                  USDC
                </span>
              </div>
            </label>
            <button
              type="submit"
              disabled={actionBusy === "usdc" || !usdcTopUpAmount}
              className="brackets-accent px-4 py-2.5 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
            >
              {actionBusy === "usdc" ? "Depositing..." : "Deposit"}
            </button>
          </form>
          {actionError && (
            <div className="mt-4 border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="mt-4 border border-line-soft p-3 text-sm text-muted bg-[rgba(10,186,181,0.04)]">
              {actionSuccess}
            </div>
          )}
        </ActionModalShell>
      )}

      {actionModal === "sol" && (
        <ActionModalShell
          eyebrow="Top up agent SOL"
          title="Fund the agent for transaction fees"
          onClose={closeActionModal}
        >
          <p className="mb-5 text-sm leading-relaxed text-muted">
            The agent wallet pays for agent-signed transactions and proposal
            creation. This sends SOL to the agent address, not the vault PDA.
          </p>
          <div className="mb-5">
            <p className="mb-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
              Agent wallet
            </p>
            <div className="flex min-w-0 flex-col gap-3 border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all font-display text-sm text-text">
                {vault.agent.toBase58()}
              </code>
              <CopyButton value={vault.agent.toBase58()} label="Copy" />
            </div>
          </div>
          <form onSubmit={topUpAgentSol} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-2 block text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
                Amount
              </span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={solTopUpAmount}
                  onChange={(event) => setSolTopUpAmount(event.target.value)}
                  className="w-full border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-2.5 pr-14 font-display text-sm text-text focus:outline-none focus:border-line"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] uppercase tracking-[0.12em] text-muted font-display">
                  SOL
                </span>
              </div>
            </label>
            <button
              type="submit"
              disabled={actionBusy === "sol" || !solTopUpAmount}
              className="brackets-accent px-4 py-2.5 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
            >
              {actionBusy === "sol" ? "Sending..." : "Send SOL"}
            </button>
          </form>
          {actionError && (
            <div className="mt-4 border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="mt-4 border border-line-soft p-3 text-sm text-muted bg-[rgba(10,186,181,0.04)]">
              {actionSuccess}
            </div>
          )}
        </ActionModalShell>
      )}

      {actionModal === "limit" && (
        <ActionModalShell
          eyebrow="Edit allowance"
          title="Set agent spending limit"
          onClose={closeActionModal}
        >
          <p className="mb-5 text-sm leading-relaxed text-muted">
            This is the maximum USDC amount your agent can send in one
            transaction without human approval.
          </p>
          <form onSubmit={updateLimit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-2 block text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
                New limit
              </span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={limitInput}
                  onChange={(event) => setLimitInput(event.target.value)}
                  className="w-full border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-2.5 pr-16 font-display text-sm text-text focus:outline-none focus:border-line"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] uppercase tracking-[0.12em] text-muted font-display">
                  USDC
                </span>
              </div>
            </label>
            <button
              type="submit"
              disabled={actionBusy === "limit"}
              className="brackets-accent px-4 py-2.5 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
            >
              {actionBusy === "limit" ? "Saving..." : "Save limit"}
            </button>
          </form>
          {actionError && (
            <div className="mt-4 border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="mt-4 border border-line-soft p-3 text-sm text-muted bg-[rgba(10,186,181,0.04)]">
              {actionSuccess}
            </div>
          )}
        </ActionModalShell>
      )}
    </div>
  );
}
