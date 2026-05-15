"use client";

import { useEffect, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getProgram } from "@/lib/program";
import { protocolConfigPda } from "@/lib/pdas";
import { formatSol, formatUsdc, usdcToRaw } from "@/lib/format";
import type { VaultData } from "./VaultDetail";

const ONE_USDC_RAW = BigInt(1_000_000);
const FUNDED_THRESHOLD_RAW = BigInt(10_000);

function CopyButton({
  value,
  label = "Copy",
  tone = "default",
}: {
  value: string;
  label?: string;
  tone?: "default" | "dark";
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
      className={`shrink-0 border px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.14em] transition-colors ${
        tone === "dark"
          ? "border-[#075654]/35 text-[#032b2a] hover:border-[#032b2a]"
          : "border-line-soft text-accent-2 hover:border-line hover:text-text"
      }`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function AddressLine({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 border-b border-line-soft last:border-b-0 sm:flex-row sm:items-center sm:gap-6">
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display sm:w-32 shrink-0">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={`min-w-0 flex-1 break-all font-display text-sm ${
            muted ? "text-muted" : "text-text"
          }`}
        >
          {value}
        </div>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function TextLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-line-soft last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display sm:w-32 shrink-0">
        {label}
      </div>
      <div className="font-display text-sm break-all text-text">{value}</div>
    </div>
  );
}

function normalizeWithdrawError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { error?: { errorMessage?: string }; message?: string };
    if (maybeError.error?.errorMessage) return maybeError.error.errorMessage;
    if (maybeError.message?.includes("User rejected")) {
      return "The wallet rejected the signature request.";
    }
    if (maybeError.message) return maybeError.message;
  }
  return String(error);
}

function rawUsdcToInput(raw: bigint): string {
  const whole = raw / ONE_USDC_RAW;
  const fraction = raw % ONE_USDC_RAW;
  if (fraction === BigInt(0)) return whole.toString();
  return `${whole}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function totalWithFee(rawAmount: bigint, feeBps: number): bigint {
  return rawAmount + (rawAmount * BigInt(feeBps)) / BigInt(10_000);
}

function maxWithdrawRaw(balance: bigint, feeBps: number): bigint {
  let low = BigInt(0);
  let high = balance;

  while (low < high) {
    const mid = (low + high + BigInt(1)) / BigInt(2);
    if (totalWithFee(mid, feeBps) <= balance) {
      low = mid;
    } else {
      high = mid - BigInt(1);
    }
  }

  return low;
}

function WithdrawPanel({
  vault,
  usdcBalance,
  onChange,
}: {
  vault: VaultData;
  usdcBalance: bigint | null;
  onChange: () => void;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const walletAddress = wallet?.publicKey.toBase58() ?? "";
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState(walletAddress);
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (walletAddress) {
      setRecipient(walletAddress);
    }
  }, [vault.address, walletAddress]);

  useEffect(() => {
    if (!wallet) {
      setFeeBps(null);
      return;
    }

    let cancelled = false;
    const program = getProgram(connection, wallet);
    const protocolConfig = protocolConfigPda();

    program.account.protocolConfig
      .fetch(protocolConfig)
      .then((config: { feeBps: number }) => {
        if (!cancelled) setFeeBps(Number(config.feeBps));
      })
      .catch(() => {
        if (!cancelled) setFeeBps(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connection, wallet]);

  const maxAmountRaw =
    usdcBalance !== null && feeBps !== null ? maxWithdrawRaw(usdcBalance, feeBps) : null;

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      if (!wallet.publicKey.equals(vault.human)) {
        throw new Error("Only the human owner can withdraw from this vault.");
      }

      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error("Enter a withdrawal amount greater than zero.");
      }

      const amountRaw = usdcToRaw(amountNum);
      const amountRawBigInt = BigInt(amountRaw.toString());
      const recipientWallet = new PublicKey(recipient.trim());
      const recipientAta = getAssociatedTokenAddressSync(
        vault.usdcMint,
        recipientWallet,
        true
      );
      const program = getProgram(connection, wallet);
      const protocolConfig = protocolConfigPda();
      const config = await program.account.protocolConfig.fetch(protocolConfig);
      const feeRaw = (amountRawBigInt * BigInt(Number(config.feeBps))) / BigInt(10_000);

      if (usdcBalance !== null && amountRawBigInt + feeRaw > usdcBalance) {
        throw new Error(
          `Amount plus protocol fee exceeds vault balance. Maximum total available: ${formatUsdc(
            usdcBalance
          )}.`
        );
      }

      const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
      let setupSignature: string | null = null;
      if (!recipientAtaInfo) {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            recipientAta,
            recipientWallet,
            vault.usdcMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        const latestBlockhash = await connection.getLatestBlockhash();
        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = latestBlockhash.blockhash;
        const signedTx = await wallet.signTransaction(tx);
        setupSignature = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(
          { signature: setupSignature, ...latestBlockhash },
          "confirmed"
        );
      }

      const signature = await program.methods
        .sendUsdc(amountRaw)
        .accounts({
          signer: wallet.publicKey,
          vault: vault.address,
          vaultUsdcAta: vault.vaultUsdcAta,
          recipientAta,
          whitelistEntry: null,
          protocolConfig,
          stakerRewardAta: config.stakerRewardAta,
          treasuryAta: config.treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      setAmount("");
      setSuccess(
        `${formatUsdc(amountRawBigInt)} withdrawn. Fee: ${formatUsdc(feeRaw)}.${
          setupSignature ? " Recipient USDC account was created first." : ""
        } Tx: ${signature}`
      );
      onChange();
    } catch (withdrawError) {
      setError(normalizeWithdrawError(withdrawError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="brackets p-5">
      <div className="mb-4">
        <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-accent-2">
          Withdraw USDC
        </p>
        <h2 className="font-display text-xl font-bold text-text">
          Move funds as human owner
        </h2>
      </div>

      <form
        onSubmit={withdraw}
        className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_auto] lg:items-end"
      >
        <label className="block min-w-0">
          <span className="mb-2 block text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
            Recipient wallet
          </span>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-2.5 font-display text-sm text-text focus:outline-none focus:border-line"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
            Amount
          </span>
          <div className="relative">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-2.5 pr-24 font-display text-sm text-text focus:outline-none focus:border-line"
            />
            <button
              type="button"
              onClick={() => {
                if (maxAmountRaw !== null) setAmount(rawUsdcToInput(maxAmountRaw));
              }}
              disabled={maxAmountRaw === null || maxAmountRaw === BigInt(0)}
              className="absolute right-14 top-1/2 -translate-y-1/2 border border-line-soft px-1.5 py-0.5 text-[0.58rem] font-display uppercase tracking-[0.12em] text-accent-2 hover:border-line hover:text-text disabled:opacity-40"
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
          disabled={busy || !wallet || !amount || !recipient}
          className="brackets-accent px-4 py-2.5 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
      </form>

      {error && (
        <div className="mt-4 border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-4 break-all border border-line-soft p-3 text-sm text-muted bg-[rgba(10,186,181,0.04)]">
          {success}
        </div>
      )}
    </div>
  );
}

export function VaultOverview({
  vault,
  usdcBalance,
  onTopUpUsdc,
}: {
  vault: VaultData;
  usdcBalance: bigint | null;
  onTopUpUsdc: () => void;
}) {
  const needsDeposit = usdcBalance !== null && usdcBalance < ONE_USDC_RAW;
  const showInitialDepositPanel =
    usdcBalance === null || usdcBalance <= FUNDED_THRESHOLD_RAW;
  const depositAddress = vault.vaultUsdcAta.toBase58();

  return (
    <div className="space-y-4">
      {showInitialDepositPanel && (
        <div
          className={`p-5 ${
            needsDeposit
              ? "brackets-accent text-[#032b2a] shadow-[0_14px_36px_rgba(10,186,181,0.18)]"
              : "brackets"
          }`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div
                className={`mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] ${
                  needsDeposit ? "text-[#064947]" : "text-accent-2"
                }`}
              >
                {needsDeposit ? "Deposit needed" : "Deposit USDC"}
              </div>
              <h2
                className={`font-display text-xl font-bold ${
                  needsDeposit ? "text-[#032b2a]" : "text-text"
                }`}
              >
                USDC deposit address
              </h2>
              <p
                className={`mt-1 text-sm ${
                  needsDeposit ? "text-[#075654]" : "text-muted"
                }`}
              >
                Copy the address or deposit directly from your connected wallet.
              </p>
            </div>

            <div className="min-w-0 flex-1 lg:max-w-3xl">
              <div
                className={`flex min-w-0 flex-col gap-3 border px-3 py-3 sm:flex-row sm:items-center ${
                  needsDeposit
                    ? "border-[#075654]/35 bg-[rgba(3,43,42,0.1)]"
                    : "border-line-soft bg-[rgba(2,10,12,0.7)]"
                }`}
              >
                <code
                  className={`min-w-0 flex-1 break-all font-display text-sm ${
                    needsDeposit ? "text-[#032b2a]" : "text-text"
                  }`}
                >
                  {depositAddress}
                </code>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <CopyButton
                    value={depositAddress}
                    label="Copy address"
                    tone={needsDeposit ? "dark" : "default"}
                  />
                  <button
                    type="button"
                    onClick={onTopUpUsdc}
                    className={`shrink-0 border px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.14em] transition-colors ${
                      needsDeposit
                        ? "border-[#075654]/35 text-[#032b2a] hover:border-[#032b2a]"
                        : "border-line-soft text-accent-2 hover:border-line hover:text-text"
                    }`}
                  >
                    Top up
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="brackets p-6">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display mb-4">
          Vault details
        </p>
        <AddressLine label="Human wallet" value={vault.human.toBase58()} />
        <AddressLine label="Agent wallet" value={vault.agent.toBase58()} />
        <AddressLine label="USDC vault wallet" value={vault.vaultUsdcAta.toBase58()} />
        <TextLine label="Proposals created" value={vault.proposalCount.toString()} />

        <details className="group mt-4 border border-line-soft bg-[rgba(2,10,12,0.45)] px-4">
          <summary className="cursor-pointer list-none py-3 font-display text-[0.65rem] uppercase tracking-[0.18em] text-muted transition-colors hover:text-text">
            Advanced addresses
          </summary>
          <div className="border-t border-line-soft pb-1">
            <AddressLine label="Vault control PDA" value={vault.address.toBase58()} muted />
            <AddressLine label="USDC mint" value={vault.usdcMint.toBase58()} muted />
          </div>
        </details>
      </div>
    </div>
  );
}

export function FundsPanel({
  vault,
  usdcBalance,
  agentSolBalance,
  onChange,
  onTopUpUsdc,
  onTopUpSol,
}: {
  vault: VaultData;
  usdcBalance: bigint | null;
  agentSolBalance: number | null;
  onChange: () => void;
  onTopUpUsdc: () => void;
  onTopUpSol: () => void;
}) {
  const usdcDepositAddress = vault.vaultUsdcAta.toBase58();
  const agentAddress = vault.agent.toBase58();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="brackets p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-accent-2">
                Deposit USDC
              </p>
              <h2 className="font-display text-xl font-bold text-text">
                Fund vault balance
              </h2>
              <p className="mt-1 text-sm text-muted">
                Current balance:{" "}
                {usdcBalance === null ? "..." : formatUsdc(usdcBalance)}
              </p>
            </div>
            <button
              type="button"
              onClick={onTopUpUsdc}
              className="brackets-accent px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a]"
            >
              Top up
            </button>
          </div>

          <div className="border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-3">
            <p className="mb-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
              USDC deposit account
            </p>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all font-display text-sm text-text">
                {usdcDepositAddress}
              </code>
              <CopyButton value={usdcDepositAddress} label="Copy" />
            </div>
          </div>
        </section>

        <section className="brackets p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-accent-2">
                Agent SOL
              </p>
              <h2 className="font-display text-xl font-bold text-text">
                Fund agent gas
              </h2>
              <p className="mt-1 text-sm text-muted">
                Current balance:{" "}
                {agentSolBalance === null ? "..." : formatSol(agentSolBalance)}
              </p>
            </div>
            <button
              type="button"
              onClick={onTopUpSol}
              className="brackets-accent px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a]"
            >
              Top up
            </button>
          </div>

          <div className="border border-line-soft bg-[rgba(2,10,12,0.7)] px-3 py-3">
            <p className="mb-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted font-display">
              Agent wallet
            </p>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all font-display text-sm text-text">
                {agentAddress}
              </code>
              <CopyButton value={agentAddress} label="Copy" />
            </div>
          </div>
        </section>
      </div>

      <WithdrawPanel vault={vault} usdcBalance={usdcBalance} onChange={onChange} />
    </div>
  );
}
