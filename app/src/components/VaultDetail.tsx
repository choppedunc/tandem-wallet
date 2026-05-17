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
  rawUsdcToInput,
  rawToUsdc,
  shortAddress,
  usdcToRaw,
} from "@/lib/format";
import { buildAgentSetupCommand } from "@/lib/agentSetup";
import { explorerTxUrl } from "@/lib/network";
import {
  SETUP_CHECKLIST_ITEMS,
  firstIncompleteSetupItem,
  loadSetupChecklistProgress,
  saveSetupChecklistProgress,
  type SetupChecklistItemId,
  type SetupChecklistProgress,
} from "@/lib/onboarding";
import { getProgram } from "@/lib/program";
import { FundsPanel, VaultOverview } from "./VaultOverview";
import { ProposalHistoryPanel } from "./ProposalHistoryPanel";
import { ProposalsPanel } from "./ProposalsPanel";
import { WhitelistPanel } from "./WhitelistPanel";
import { AgentConnectorPanel } from "./AgentConnectorPanel";
import { AttentionPulse } from "./AttentionPulse";
import { ToastStack, type ToastNotification } from "./ToastStack";

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
  | "setup"
  | "overview"
  | "funds"
  | "proposals"
  | "history"
  | "whitelist"
  | "agent";
const LIVE_REFRESH_INTERVAL_MS = 45_000;
const LIVE_REFRESH_DEBOUNCE_MS = 750;
const SETUP_USDC_THRESHOLD_RAW = BigInt(1_000_000);
const AGENT_COMMAND_COPIED_STORAGE_KEY = "tandem:agent-command-copied:v1";

type ActionModal = "usdc" | "sol" | "limit" | null;

type DirectSendNotificationPayload = {
  directSends?: {
    id: string;
    signature: string;
    signer: string;
    recipient: string;
    amount: string;
    blockTime: number | null;
    whitelisted: boolean;
  }[];
};

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

function agentCommandCopiedKey(vaultAddress: PublicKey): string {
  return `${AGENT_COMMAND_COPIED_STORAGE_KEY}:${vaultAddress.toBase58()}`;
}

function createToastId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function loadAgentCommandCopied(vaultAddress: PublicKey): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(agentCommandCopiedKey(vaultAddress)) === "1";
  } catch {
    return false;
  }
}

function saveAgentCommandCopied(vaultAddress: PublicKey) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(agentCommandCopiedKey(vaultAddress), "1");
  } catch {
    // Setup progress markers should not block vault use.
  }
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
  tone = "default",
  onboardingId,
  actionLabel,
  actionDisabled,
  onAction,
  attention,
  attentionLabel,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  tone?: "default" | "danger";
  onboardingId?: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  attention?: boolean;
  attentionLabel?: string;
}) {
  const isDanger = tone === "danger";

  return (
    <div
      data-onboarding={onboardingId}
      className={`border px-4 py-3 ${
        isDanger
          ? "border-[#d45f67]/55 bg-[rgba(58,23,25,0.58)]"
          : "border-line-soft bg-[rgba(3,17,19,0.7)]"
      }`}
    >
      <div className="mb-2 flex min-h-8 items-start justify-between gap-3">
        <div
          className={`text-[0.65rem] uppercase tracking-[0.18em] font-display ${
            isDanger ? "text-[#f2b1b6]" : "text-muted"
          }`}
        >
          {label}
        </div>
        {actionLabel && onAction ? (
          <div className="flex shrink-0 items-center gap-2">
            {attention ? <AttentionPulse label={attentionLabel} /> : null}
            <button
              type="button"
              onClick={onAction}
              disabled={actionDisabled}
              className={`border px-2.5 py-1 text-[0.6rem] font-display uppercase tracking-[0.14em] transition-colors disabled:opacity-50 ${
                isDanger
                  ? "border-[#d45f67]/45 text-[#f2b1b6] hover:border-[#d45f67] hover:bg-[rgba(212,95,103,0.14)] hover:text-[#ffd7da]"
                  : "border-line-soft text-accent-2 hover:border-line hover:text-text"
              }`}
            >
              {actionLabel}
            </button>
          </div>
        ) : null}
      </div>
      <div className={`font-display text-base ${accent ?? "text-text"}`}>
        {value}
      </div>
    </div>
  );
}

const MANUAL_SETUP_ITEMS = new Set<SetupChecklistItemId>(["agent-json-file"]);

function SetupPanel({
  completedItems,
  manualItems,
  autoItems,
  onAction,
  onToggleItem,
  onMarkAllDone,
  onFinish,
}: {
  completedItems: Set<SetupChecklistItemId>;
  manualItems: Set<SetupChecklistItemId>;
  autoItems: Set<SetupChecklistItemId>;
  onAction: (item: SetupChecklistItemId) => void;
  onToggleItem: (item: SetupChecklistItemId, completed: boolean) => void;
  onMarkAllDone: () => void;
  onFinish: () => void;
}) {
  const allComplete = SETUP_CHECKLIST_ITEMS.every((item) =>
    completedItems.has(item.id)
  );
  const nextItem = firstIncompleteSetupItem([...completedItems]);

  return (
    <div className="space-y-4">
      <section className="brackets p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-3 text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
              Setup
            </p>
            <h2 className="font-display text-2xl font-bold text-text">
              Finish Tandem setup
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Complete these once after vault creation. The setup tab hides
              when the checklist is finished.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="border border-line-soft px-3 py-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-muted">
              {completedItems.size} / {SETUP_CHECKLIST_ITEMS.length}
            </div>
            {!allComplete ? (
              <button
                type="button"
                onClick={onMarkAllDone}
                className="border border-line-soft px-3 py-2 text-[0.65rem] font-display uppercase tracking-[0.14em] text-muted transition-colors hover:border-line hover:text-text"
              >
                Mark all done
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          {SETUP_CHECKLIST_ITEMS.map((item) => {
            const completed = completedItems.has(item.id);
            const manuallyCompleted = manualItems.has(item.id);
            const automaticallyCompleted = autoItems.has(item.id);
            const canMark =
              MANUAL_SETUP_ITEMS.has(item.id) && !automaticallyCompleted;
            const isNext = item.id === nextItem;

            return (
              <div
                key={item.id}
                className={`border p-4 ${
                  completed
                    ? "border-line-soft bg-[rgba(10,186,181,0.04)]"
                    : isNext
                      ? "border-line bg-[rgba(10,186,181,0.08)]"
                      : "border-line-soft bg-[rgba(2,10,12,0.45)]"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center border font-display text-[0.6rem] ${
                          completed
                            ? "border-accent text-accent"
                            : "border-line-soft text-muted"
                        }`}
                        aria-hidden="true"
                      >
                        {completed ? "OK" : ""}
                      </span>
                      <p className="font-display text-sm font-bold uppercase tracking-[0.14em] text-text">
                        {item.title}
                      </p>
                      {isNext && !completed ? (
                        <span className="border border-line-soft px-2 py-0.5 font-display text-[0.55rem] uppercase tracking-[0.14em] text-accent-2">
                          Next
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed text-muted">
                      {item.body}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {item.actionLabel && !completed ? (
                      <button
                        type="button"
                        onClick={() => onAction(item.id)}
                        className="border border-line-soft px-3 py-2 text-[0.65rem] font-display uppercase tracking-[0.14em] text-accent-2 transition-colors hover:border-line hover:text-text"
                      >
                        {item.actionLabel}
                      </button>
                    ) : null}
                    {canMark ? (
                      <button
                        type="button"
                        onClick={() => onToggleItem(item.id, !completed)}
                        className={`border px-3 py-2 text-[0.65rem] font-display uppercase tracking-[0.14em] transition-colors ${
                          completed
                            ? "border-line-soft text-muted hover:border-line hover:text-text"
                            : "border-line text-text hover:bg-[rgba(10,186,181,0.08)]"
                        }`}
                      >
                        {manuallyCompleted ? "Undo" : "Mark done"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {allComplete ? (
        <section className="brackets-accent p-6 text-[#032b2a]">
          <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em]">
            Done
          </p>
          <h2 className="font-display text-2xl font-bold">
            You&apos;re all set up
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#075654]">
            Ask your agent to check vault state and start spending with Tandem.
          </p>
          <button
            type="button"
            onClick={onFinish}
            className="mt-5 border border-[#075654]/35 px-4 py-2 text-xs font-display font-bold uppercase tracking-[0.14em] text-[#032b2a] transition-colors hover:border-[#032b2a]"
          >
            Finish setup
          </button>
        </section>
      ) : null}
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
  const walletAddress = wallet?.publicKey.toBase58() ?? null;
  const [tab, setTab] = useState<VaultTab>("setup");
  const [appUrl, setAppUrl] = useState("http://localhost:3000");
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [agentSolBalance, setAgentSolBalance] = useState<number | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [agentCommandCopied, setAgentCommandCopied] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [usdcTopUpAmount, setUsdcTopUpAmount] = useState("");
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<bigint | null>(null);
  const [solTopUpAmount, setSolTopUpAmount] = useState("");
  const [limitInput, setLimitInput] = useState(
    rawToUsdc(vault.spendingLimit).toString()
  );
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [historyFocusProposal, setHistoryFocusProposal] = useState<string | null>(null);
  const [tabPanelResetKey, setTabPanelResetKey] = useState(0);
  const [setupProgress, setSetupProgress] = useState<SetupChecklistProgress>({
    completedItems: [],
    dismissed: false,
    updatedAt: new Date().toISOString(),
  });
  const appliedInitialViewRef = useRef<string | null>(null);
  const balancesRefreshInFlightRef = useRef(false);
  const pendingRefreshInFlightRef = useRef(false);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const directSendSeenIdsRef = useRef<Set<string>>(new Set());
  const directSendMonitorReadyRef = useRef(false);
  const directSendMonitorInFlightRef = useRef(false);

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  useEffect(() => {
    if (!initialTab) return;
    const key = `${vault.address.toBase58()}:${initialTab}:${
      initialProposal ?? ""
    }`;
    if (appliedInitialViewRef.current === key) return;
    appliedInitialViewRef.current = key;
    setTab(initialTab);
    setHistoryFocusProposal(null);
    setTabPanelResetKey((current) => current + 1);
  }, [initialProposal, initialTab, vault.address]);

  useEffect(() => {
    setLimitInput(rawToUsdc(vault.spendingLimit).toString());
  }, [vault.address, vault.spendingLimit]);

  useEffect(() => {
    setAgentCommandCopied(loadAgentCommandCopied(vault.address));
  }, [vault.address]);

  useEffect(() => {
    setSetupProgress(
      loadSetupChecklistProgress(
        walletAddress,
        vault.address.toBase58()
      )
    );
  }, [vault.address, walletAddress]);

  const showToast = useCallback((toast: Omit<ToastNotification, "id">) => {
    setToasts((current) =>
      [...current, { ...toast, id: createToastId() }].slice(-4)
    );
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const switchTab = useCallback(
    (
      nextTab: VaultTab,
      options?: { focusHistoryProposal?: string | null }
    ) => {
      setHistoryFocusProposal(options?.focusHistoryProposal ?? null);
      setTabPanelResetKey((current) => current + 1);
      setTab(nextTab);
    },
    []
  );

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

  const refreshWalletUsdcBalance = useCallback(async () => {
    if (!wallet) {
      setWalletUsdcBalance(null);
      return;
    }

    try {
      const sourceAta = getAssociatedTokenAddressSync(
        vault.usdcMint,
        wallet.publicKey
      );
      const sourceAccount = await getAccount(connection, sourceAta);
      setWalletUsdcBalance(sourceAccount.amount);
    } catch {
      setWalletUsdcBalance(BigInt(0));
    }
  }, [connection, vault.usdcMint, wallet]);

  const checkDirectSendNotifications = useCallback(async () => {
    if (directSendMonitorInFlightRef.current) return;
    directSendMonitorInFlightRef.current = true;

    try {
      const response = await fetch(
        `/api/vault-history?vault=${vault.address.toBase58()}`,
        { cache: "no-store" }
      );
      if (!response.ok) return;

      const payload = (await response.json()) as DirectSendNotificationPayload;
      const agentSends = (payload.directSends ?? [])
        .filter((transfer) => transfer.signer === vault.agent.toBase58())
        .sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));

      if (!directSendMonitorReadyRef.current) {
        agentSends.forEach((transfer) =>
          directSendSeenIdsRef.current.add(transfer.id)
        );
        directSendMonitorReadyRef.current = true;
        return;
      }

      agentSends.forEach((transfer) => {
        if (directSendSeenIdsRef.current.has(transfer.id)) return;
        directSendSeenIdsRef.current.add(transfer.id);
        showToast({
          title: transfer.whitelisted
            ? "Whitelist payment sent"
            : "Allowance payment sent",
          message: `${formatUsdc(BigInt(transfer.amount))} to ${shortAddress(
            transfer.recipient,
            6
          )}.`,
          actionLabel: "View in Explorer",
          href: explorerTxUrl(transfer.signature),
          external: true,
        });
      });
    } catch {
      // Live direct-send notifications are best-effort; history still shows them.
    } finally {
      directSendMonitorInFlightRef.current = false;
    }
  }, [showToast, vault.address, vault.agent]);

  useEffect(() => {
    directSendSeenIdsRef.current = new Set();
    directSendMonitorReadyRef.current = false;
    directSendMonitorInFlightRef.current = false;
  }, [vault.address]);

  useEffect(() => {
    refreshBalances();
    refreshPendingProposalCount();
    void checkDirectSendNotifications();
  }, [
    checkDirectSendNotifications,
    refreshBalances,
    refreshPendingProposalCount,
  ]);

  useEffect(() => {
    if (actionModal === "usdc") {
      void refreshWalletUsdcBalance();
    }
  }, [actionModal, refreshWalletUsdcBalance]);

  useEffect(() => {
    let cancelled = false;

    const refreshLiveState = () => {
      if (cancelled) return;
      void refreshBalances();
      void refreshPendingProposalCount();
      void checkDirectSendNotifications();
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
    checkDirectSendNotifications,
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

  const markAgentCommandCopied = useCallback(() => {
    saveAgentCommandCopied(vault.address);
    setAgentCommandCopied(true);
  }, [vault.address]);

  function openActionModal(modal: Exclude<ActionModal, null>) {
    setActionError(null);
    setActionSuccess(null);
    if (modal === "usdc") {
      setWalletUsdcBalance(null);
    }
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
        setWalletUsdcBalance(sourceAccount.amount);
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
      setWalletUsdcBalance((current) =>
        current === null ? current : current - amountRawBigInt
      );
      setUsdcBalance((current) =>
        current === null ? current : current + amountRawBigInt
      );
      showToast({
        title: "Deposit successful",
        message: `${formatUsdc(amountRawBigInt)} deposited into the vault.`,
        actionLabel: "View in Explorer",
        href: explorerTxUrl(signature),
        external: true,
      });
      setActionModal(null);
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
      showToast({
        title: "Top up successful",
        message: `${formatSol(lamports)} sent to the agent wallet.`,
        actionLabel: "View in Explorer",
        href: explorerTxUrl(signature),
        external: true,
      });
      setActionModal(null);
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

  const needsUsdcTopUp =
    usdcBalance !== null && usdcBalance < SETUP_USDC_THRESHOLD_RAW;
  const needsAgentSolTopUp =
    agentSolBalance !== null && agentSolBalance <= 0;
  const needsAgentSetupAttention = needsAgentSolTopUp || !agentCommandCopied;
  const needsFundsAttention = needsUsdcTopUp || needsAgentSolTopUp;
  const setupCommand = useMemo(
    () =>
      buildAgentSetupCommand({
        vaultAddress: vault.address.toBase58(),
        appUrl,
      }),
    [appUrl, vault.address]
  );
  const autoCompletedSetupItems = useMemo<SetupChecklistItemId[]>(() => {
    const completed: SetupChecklistItemId[] = [];
    if (usdcBalance !== null && usdcBalance >= SETUP_USDC_THRESHOLD_RAW) {
      completed.push("deposit-usdc");
    }
    if (agentSolBalance !== null && agentSolBalance > 0) {
      completed.push("deposit-agent-sol");
    }
    if (agentCommandCopied) {
      completed.push("agent-setup-command");
    }
    return completed;
  }, [agentCommandCopied, agentSolBalance, usdcBalance]);
  const manualCompletedSetupItems = useMemo(
    () => new Set<SetupChecklistItemId>(setupProgress.completedItems),
    [setupProgress.completedItems]
  );
  const autoCompletedSetupItemSet = useMemo(
    () => new Set<SetupChecklistItemId>(autoCompletedSetupItems),
    [autoCompletedSetupItems]
  );
  const completedSetupItems = useMemo(
    () =>
      new Set<SetupChecklistItemId>([
        ...manualCompletedSetupItems,
        ...autoCompletedSetupItems,
      ]),
    [autoCompletedSetupItems, manualCompletedSetupItems]
  );
  const setupComplete = SETUP_CHECKLIST_ITEMS.every((item) =>
    completedSetupItems.has(item.id)
  );
  const showSetupTab = !setupProgress.dismissed || !setupComplete;

  const tabs: {
    id: VaultTab;
    label: string;
    badge?: number;
    attention?: boolean;
    attentionLabel?: string;
  }[] = useMemo(
    () => [
      ...(showSetupTab
        ? [
            {
              id: "setup" as const,
              label: "Setup",
              attention: !setupComplete,
              attentionLabel: "Setup checklist incomplete",
            },
          ]
        : []),
      { id: "overview", label: "Overview" },
      {
        id: "funds",
        label: "Funds",
        attention: needsFundsAttention,
        attentionLabel: "Vault funding needed",
      },
      { id: "proposals", label: "Proposals", badge: pendingProposalCount },
      { id: "history", label: "History" },
      { id: "whitelist", label: "Whitelist" },
      {
        id: "agent",
        label: "Agent",
        attention: needsAgentSetupAttention,
        attentionLabel: "Agent setup needs attention",
      },
    ],
    [
      needsAgentSetupAttention,
      needsFundsAttention,
      pendingProposalCount,
      setupComplete,
      showSetupTab,
    ]
  );

  useEffect(() => {
    if (tab === "setup" && !showSetupTab) {
      switchTab("overview");
    }
  }, [showSetupTab, switchTab, tab]);

  function saveSetupProgress(
    progress: Omit<SetupChecklistProgress, "updatedAt">
  ) {
    if (!walletAddress) return;
    setSetupProgress(
      saveSetupChecklistProgress(
        walletAddress,
        vault.address.toBase58(),
        progress
      )
    );
  }

  function toggleSetupItem(item: SetupChecklistItemId, completed: boolean) {
    const current = new Set(setupProgress.completedItems);
    if (completed) current.add(item);
    else current.delete(item);
    saveSetupProgress({
      completedItems: [...current],
      dismissed: false,
    });
  }

  function markSetupCommandCopied() {
    saveAgentCommandCopied(vault.address);
    setAgentCommandCopied(true);
  }

  async function handleSetupAction(item: SetupChecklistItemId) {
    if (item === "deposit-usdc") {
      openActionModal("usdc");
      return;
    }
    if (item === "deposit-agent-sol") {
      openActionModal("sol");
      return;
    }
    if (item === "agent-json-file") {
      switchTab("agent");
      return;
    }
    if (item === "agent-setup-command") {
      try {
        await navigator.clipboard.writeText(setupCommand);
        markSetupCommandCopied();
        saveSetupProgress({
          completedItems: [
            ...new Set<SetupChecklistItemId>([
              ...setupProgress.completedItems,
              "agent-setup-command",
            ]),
          ],
          dismissed: false,
        });
      } catch {
        setActionError("Could not copy the setup command. Open the Agent tab to copy it manually.");
      }
    }
  }

  function markAllSetupDone() {
    markSetupCommandCopied();
    saveSetupProgress({
      completedItems: SETUP_CHECKLIST_ITEMS.map((item) => item.id),
      dismissed: false,
    });
  }

  function finishSetup() {
    saveSetupProgress({
      completedItems: [...setupProgress.completedItems],
      dismissed: true,
    });
    switchTab("overview");
  }

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
            onboardingId="deposit-usdc"
            actionLabel="Top up"
            attention={needsUsdcTopUp}
            attentionLabel="Vault needs USDC"
            onAction={() => openActionModal("usdc")}
          />
          <Stat
            label="Agent SOL"
            value={agentSolBalance === null ? "…" : formatSol(agentSolBalance)}
            onboardingId="deposit-agent-sol"
            actionLabel="Top up"
            attention={needsAgentSolTopUp}
            attentionLabel="Agent wallet needs SOL"
            onAction={() => openActionModal("sol")}
          />
          <Stat
            label="Limit"
            value={formatUsdc(vault.spendingLimit)}
            onboardingId="allowance-controls"
            actionLabel="Edit"
            onAction={() => openActionModal("limit")}
          />
          <Stat
            label="Status"
            value={vault.paused ? "Agent paused" : "Active"}
            accent={vault.paused ? "text-[#ffd7da]" : "text-accent"}
            tone={vault.paused ? "danger" : "default"}
            onboardingId="pause-controls"
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
              onClick={() => switchTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-display uppercase tracking-[0.14em] border-b-2 transition-colors ${
                tab === t.id
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              <span>{t.label}</span>
              {t.badge ? (
                <span className="inline-flex items-center gap-1.5 text-accent-2">
                  <AttentionPulse label="Pending proposals" />
                  <span>({t.badge})</span>
                </span>
              ) : t.attention ? (
                <AttentionPulse label={t.attentionLabel} />
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      <div key={`${vault.address.toBase58()}:${tab}:${tabPanelResetKey}`}>
        {tab === "setup" && showSetupTab && (
          <SetupPanel
            completedItems={completedSetupItems}
            manualItems={manualCompletedSetupItems}
            autoItems={autoCompletedSetupItemSet}
            onAction={handleSetupAction}
            onToggleItem={toggleSetupItem}
            onMarkAllDone={markAllSetupDone}
            onFinish={finishSetup}
          />
        )}
        {tab === "overview" && (
          <VaultOverview
            vault={vault}
            usdcBalance={usdcBalance}
            onTopUpUsdc={() => openActionModal("usdc")}
          />
        )}
        {tab === "funds" && (
          <FundsPanel
            vault={vault}
            usdcBalance={usdcBalance}
            agentSolBalance={agentSolBalance}
            onChange={handleChange}
            onTopUpUsdc={() => openActionModal("usdc")}
            onTopUpSol={() => openActionModal("sol")}
            onNotify={showToast}
          />
        )}
        {tab === "proposals" && (
          <ProposalsPanel
            vault={vault}
            onChange={handleChange}
            initialProposal={initialProposal}
            onNotify={showToast}
            onOpenHistory={(proposalKey) => {
              switchTab("history", { focusHistoryProposal: proposalKey });
            }}
          />
        )}
        {tab === "history" && (
          <ProposalHistoryPanel
            vault={vault}
            focusedProposal={historyFocusProposal}
          />
        )}
        {tab === "whitelist" && <WhitelistPanel vault={vault} />}
        {tab === "agent" && (
          <AgentConnectorPanel
            vault={vault}
            commandCopied={agentCommandCopied}
            needsAgentSolTopUp={needsAgentSolTopUp}
            onCommandCopied={markAgentCommandCopied}
          />
        )}
      </div>

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
              <span className="mb-2 flex items-center justify-between gap-3 text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
                <span>Amount</span>
                <span>
                  {walletUsdcBalance === null
                    ? "Checking wallet"
                    : `Wallet ${formatUsdc(walletUsdcBalance)}`}
                </span>
              </span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={usdcTopUpAmount}
                  onChange={(event) => setUsdcTopUpAmount(event.target.value)}
                  className="w-full border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-2.5 pr-28 font-display text-sm text-text focus:outline-none focus:border-line"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (walletUsdcBalance !== null) {
                      setUsdcTopUpAmount(rawUsdcToInput(walletUsdcBalance));
                    }
                  }}
                  disabled={
                    walletUsdcBalance === null ||
                    walletUsdcBalance === BigInt(0) ||
                    actionBusy === "usdc"
                  }
                  className="absolute right-16 top-1/2 -translate-y-1/2 border border-line-soft px-1.5 py-0.5 text-[0.58rem] font-display uppercase tracking-[0.12em] text-accent-2 hover:border-line hover:text-text disabled:opacity-40"
                >
                  MAX
                </button>
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
      <ToastStack toasts={toasts} onClose={dismissToast} />
    </div>
  );
}
