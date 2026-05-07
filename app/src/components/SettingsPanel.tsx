"use client";

import { useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { getProgram } from "@/lib/program";
import { rawToUsdc, usdcToRaw } from "@/lib/format";
import type { VaultData } from "./VaultDetail";

export function SettingsPanel({
  vault,
  onChange,
}: {
  vault: VaultData;
  onChange: () => void;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [limit, setLimit] = useState(rawToUsdc(vault.spendingLimit).toString());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateLimit(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    setError(null);
    setBusy("limit");
    try {
      const limitNum = parseFloat(limit);
      if (isNaN(limitNum) || limitNum < 0)
        throw new Error("Limit must be ≥ 0.");
      const program = getProgram(connection, wallet);
      await (program.methods as any)
        .setLimit(usdcToRaw(limitNum))
        .accounts({ human: wallet.publicKey, vault: vault.address })
        .rpc();
      onChange();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function togglePause() {
    if (!wallet) return;
    setError(null);
    setBusy("pause");
    try {
      const program = getProgram(connection, wallet);
      const method = vault.paused ? "unpause" : "pause";
      await (program.methods as any)
        [method]()
        .accounts({ human: wallet.publicKey, vault: vault.address })
        .rpc();
      onChange();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
          {error}
        </div>
      )}

      <section className="brackets p-6">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display mb-3">
          Spending limit
        </p>
        <p className="text-sm text-muted mb-5 max-w-xl">
          Per-transaction limit your agent can spend without your approval.
          Anything above this becomes a proposal.{" "}
          <strong className="text-text">
            Set to 0 to require approval on every send.
          </strong>
        </p>
        <form onSubmit={updateLimit} className="flex gap-2 max-w-md">
          <div className="relative flex-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full px-3 py-2.5 pr-16 border border-line-soft bg-[rgba(2,10,12,0.7)] text-text font-display focus:outline-none focus:border-line"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs uppercase tracking-wider text-muted font-display">
              USDC
            </span>
          </div>
          <button
            type="submit"
            disabled={busy === "limit"}
            className="brackets-accent px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
          >
            {busy === "limit" ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <section className="brackets p-6">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display mb-3">
          Agent pause
        </p>
        <p className="text-sm text-muted mb-5 max-w-xl">
          Pausing blocks agent sends, new proposals, and proposal approvals.
          Direct human sends remain available for recovery.
        </p>
        <button
          onClick={togglePause}
          disabled={busy === "pause"}
          className={
            vault.paused
              ? "brackets-accent px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
              : "px-4 py-2.5 text-xs font-display font-bold uppercase tracking-[0.14em] border border-line text-text hover:bg-[rgba(10,186,181,0.08)] disabled:opacity-50"
          }
        >
          {busy === "pause"
            ? "Working…"
            : vault.paused
              ? "Unpause agent"
              : "Pause agent"}
        </button>
      </section>
    </div>
  );
}
