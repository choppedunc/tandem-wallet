"use client";

import { useState } from "react";
import type { VaultData } from "./VaultDetail";

const ONE_USDC_RAW = BigInt(1_000_000);

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

export function VaultOverview({
  vault,
  usdcBalance,
}: {
  vault: VaultData;
  usdcBalance: bigint | null;
}) {
  const needsDeposit = usdcBalance !== null && usdcBalance < ONE_USDC_RAW;
  const depositAddress = vault.vaultUsdcAta.toBase58();

  return (
    <div className="space-y-4">
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
              Use this account for vault USDC deposits.
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
              <CopyButton value={depositAddress} label="Copy address" tone={needsDeposit ? "dark" : "default"} />
            </div>
          </div>
        </div>
      </div>

      <div className="brackets p-6">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display mb-4">
          Vault details
        </p>
        <AddressLine label="Human wallet" value={vault.human.toBase58()} />
        <AddressLine label="Agent wallet" value={vault.agent.toBase58()} />
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
