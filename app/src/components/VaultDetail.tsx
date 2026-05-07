"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import BN from "bn.js";
import { formatUsdc, formatSol, shortAddress } from "@/lib/format";
import { getProgram } from "@/lib/program";
import { VaultOverview } from "./VaultOverview";
import { ProposalHistoryPanel } from "./ProposalHistoryPanel";
import { ProposalsPanel } from "./ProposalsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { WhitelistPanel } from "./WhitelistPanel";

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

type Tab = "overview" | "proposals" | "history" | "settings" | "whitelist";
const LIVE_REFRESH_INTERVAL_MS = 15_000;

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="border border-line-soft px-4 py-3 bg-[rgba(3,17,19,0.7)]">
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display mb-1">
        {label}
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
}: {
  vault: VaultData;
  vaultName?: string;
  onChange: () => void;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [tab, setTab] = useState<Tab>("overview");
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);

  const refreshBalances = useCallback(async () => {
    try {
      const [acct, sol] = await Promise.all([
        getAccount(connection, vault.vaultUsdcAta),
        connection.getBalance(vault.address),
      ]);
      setUsdcBalance(acct.amount);
      setSolBalance(sol);
    } catch {
      setUsdcBalance(BigInt(0));
      setSolBalance(0);
    }
  }, [connection, vault.address, vault.vaultUsdcAta]);

  const refreshPendingProposalCount = useCallback(async () => {
    if (!wallet) return;
    try {
      const program = getProgram(connection, wallet);
      const accounts = await (program.account as any).proposal.all([
        { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
      ]);
      setPendingProposalCount(
        accounts.filter(
          (account: any) => !account.account.executed && !account.account.cancelled
        ).length
      );
    } catch {
      setPendingProposalCount(0);
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

    const vaultSubscription = connection.onAccountChange(
      vault.address,
      () => {
        refreshLiveState();
        onChange();
      },
      "confirmed"
    );
    const vaultUsdcSubscription = connection.onAccountChange(
      vault.vaultUsdcAta,
      refreshLiveState,
      "confirmed"
    );
    const interval = window.setInterval(refreshLiveState, LIVE_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void connection.removeAccountChangeListener(vaultSubscription);
      void connection.removeAccountChangeListener(vaultUsdcSubscription);
    };
  }, [
    connection,
    onChange,
    refreshBalances,
    refreshPendingProposalCount,
    vault.address,
    vault.vaultUsdcAta,
  ]);

  const handleChange = useCallback(() => {
    refreshPendingProposalCount();
    onChange();
  }, [onChange, refreshPendingProposalCount]);

  const tabs: { id: Tab; label: string; badge?: number }[] = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      { id: "proposals", label: "Proposals", badge: pendingProposalCount },
      { id: "history", label: "History" },
      { id: "settings", label: "Settings" },
      { id: "whitelist", label: "Whitelist" },
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
          />
          <Stat
            label="SOL"
            value={solBalance === null ? "…" : formatSol(solBalance)}
          />
          <Stat label="Limit" value={formatUsdc(vault.spendingLimit)} />
          <Stat
            label="Status"
            value={vault.paused ? "Agent paused" : "Active"}
            accent={vault.paused ? "text-accent-2" : "text-accent"}
          />
        </div>
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
                  <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
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
        <VaultOverview vault={vault} usdcBalance={usdcBalance} onChange={handleChange} />
      )}
      {tab === "proposals" && <ProposalsPanel vault={vault} onChange={handleChange} />}
      {tab === "history" && <ProposalHistoryPanel vault={vault} />}
      {tab === "settings" && <SettingsPanel vault={vault} onChange={handleChange} />}
      {tab === "whitelist" && <WhitelistPanel vault={vault} />}
    </div>
  );
}
