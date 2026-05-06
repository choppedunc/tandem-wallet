"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { protocolConfigPda } from "@/lib/pdas";
import { formatUsdc, shortAddress } from "@/lib/format";
import type { VaultData } from "./VaultDetail";

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
  buybackAta: PublicKey;
};

type LastTransaction = {
  action: "approved" | "cancelled";
  proposalKey: string;
  signature: string;
  setupSignature?: string;
};

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

export function ProposalsPanel({
  vault,
  onChange,
}: {
  vault: VaultData;
  onChange: () => void;
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
  const [lastTransaction, setLastTransaction] = useState<LastTransaction | null>(null);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const refresh = useCallback(async () => {
    if (!program) return;
    setError(null);
    try {
      const protocolConfigAddress = protocolConfigPda();
      const [accts, cfg, vaultTokenAccount] = await Promise.all([
        (program.account as any).proposal.all([
          { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
        ]),
        (program.account as any).protocolConfig.fetch(protocolConfigAddress),
        getAccount(connection, vault.vaultUsdcAta),
      ]);

      const list: Proposal[] = accts.map((a: any) => ({
        pda: a.publicKey as PublicKey,
        proposalId: a.account.proposalId as BN,
        recipient: a.account.recipient as PublicKey,
        recipientAta: a.account.recipientAta as PublicKey,
        amount: a.account.amount as BN,
        proposedAt: a.account.proposedAt as BN,
        executed: a.account.executed as boolean,
        cancelled: a.account.cancelled as boolean,
        memo: a.account.memo as string,
      }));
      list.sort((a, b) => b.proposalId.cmp(a.proposalId));

      setProposals(list);
      setProtocolConfig({
        feeBps: Number(cfg.feeBps),
        stakerRewardAta: cfg.stakerRewardAta as PublicKey,
        buybackAta: cfg.buybackAta as PublicKey,
      });
      setVaultBalance(vaultTokenAccount.amount);
    } catch (e: any) {
      setError(normalizeError(e));
    }
  }, [connection, program, vault.address, vault.vaultUsdcAta]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    if (!proposals) return [];
    return proposals.filter((proposal) => statusOf(proposal) === "pending");
  }, [proposals]);

  useEffect(() => {
    if (visible.length === 0) {
      setSelectedProposalKey(null);
      return;
    }
    if (!selectedProposalKey || !visible.some((p) => p.pda.toBase58() === selectedProposalKey)) {
      setSelectedProposalKey(visible[0].pda.toBase58());
    }
  }, [selectedProposalKey, visible]);

  const selectedProposal =
    visible.find((proposal) => proposal.pda.toBase58() === selectedProposalKey) ??
    visible[0] ??
    null;

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
    setBusy(`approve:${proposalKey}`);
    setError(null);
    setLastTransaction(null);
    try {
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
      const signature = await (program.methods as any)
        .approveProposal()
        .accounts({
          human: wallet!.publicKey,
          vault: vault.address,
          proposal: proposal.pda,
          vaultUsdcAta: vault.vaultUsdcAta,
          recipientAta: proposal.recipientAta,
          protocolConfig: protocolConfigAddress,
          stakerRewardAta: protocolConfig.stakerRewardAta,
          buybackAta: protocolConfig.buybackAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      setLastTransaction({
        action: "approved",
        proposalKey,
        signature,
        setupSignature,
      });
      await refresh();
      onChange();
    } catch (e: any) {
      setError(normalizeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(proposal: Proposal) {
    if (!program) return;
    const proposalKey = proposal.pda.toBase58();
    setBusy(`cancel:${proposalKey}`);
    setError(null);
    setLastTransaction(null);
    try {
      const signature = await (program.methods as any)
        .cancelProposal()
        .accounts({
          human: wallet!.publicKey,
          vault: vault.address,
          proposal: proposal.pda,
        })
        .rpc();

      setLastTransaction({
        action: "cancelled",
        proposalKey,
        signature,
      });
      await refresh();
      onChange();
    } catch (e: any) {
      setError(normalizeError(e));
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
        ? "Unpause the vault before approving."
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

      {lastTransaction && (
        <div className="border border-line-soft bg-[rgba(3,17,19,0.78)] p-4 text-sm">
          <div className="font-display text-accent-2 uppercase tracking-[0.14em] text-xs">
            Proposal {lastTransaction.action}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {lastTransaction.setupSignature && (
              <a
                href={explorerTxUrl(lastTransaction.setupSignature)}
                target="_blank"
                rel="noreferrer"
                className="text-muted hover:text-text underline underline-offset-4"
              >
                Token account setup
              </a>
            )}
            <a
              href={explorerTxUrl(lastTransaction.signature)}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:text-text underline underline-offset-4"
            >
              View transaction
            </a>
          </div>
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
                  label="Recipient wallet"
                  value={selectedProposal.recipient.toBase58()}
                />
                <DetailRow
                  label="Recipient USDC"
                  value={selectedProposal.recipientAta.toBase58()}
                />
                <DetailRow label="Agent" value={vault.agent.toBase58()} />
                <DetailRow label="Vault" value={vault.address.toBase58()} />
                <DetailRow
                  label="Memo"
                  value={selectedProposal.memo || "No memo supplied"}
                />
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
              </div>

              {selectedStatus === "pending" && (
                <div className="mt-5">
                  {approveBlockedReason && (
                    <div className="mb-3 border border-line-soft bg-[rgba(10,186,181,0.04)] p-3 text-sm text-muted">
                      {approveBlockedReason}
                    </div>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => approve(selectedProposal)}
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
                      onClick={() => cancel(selectedProposal)}
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
    </div>
  );
}
