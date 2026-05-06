"use client";

import { useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import BN from "bn.js";
import { formatUsdc, formatSol, shortAddress } from "@/lib/format";
import { VaultOverview } from "./VaultOverview";
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

type Tab = "overview" | "proposals" | "settings" | "whitelist";

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
  onChange,
}: {
  vault: VaultData;
  onChange: () => void;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [tab, setTab] = useState<Tab>("overview");
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [acct, sol] = await Promise.all([
          getAccount(connection, vault.vaultUsdcAta),
          connection.getBalance(vault.address),
        ]);
        if (cancelled) return;
        setUsdcBalance(acct.amount);
        setSolBalance(sol);
      } catch {
        if (!cancelled) {
          setUsdcBalance(BigInt(0));
          setSolBalance(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, vault.address, vault.vaultUsdcAta]);

  const tabs: { id: Tab; label: string }[] = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      { id: "proposals", label: "Proposals" },
      { id: "settings", label: "Settings" },
      { id: "whitelist", label: "Whitelist" },
    ],
    []
  );

  return (
    <div>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-display mb-2">
          Vault
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-text">
            {shortAddress(vault.address.toBase58(), 6)}
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
            value={vault.paused ? "Paused" : "Active"}
            accent={vault.paused ? "text-accent-2" : "text-accent"}
          />
        </div>
      </div>

      <div className="border-b border-line-soft mb-8">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-xs font-display uppercase tracking-[0.14em] border-b-2 transition-colors ${
                tab === t.id
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && <VaultOverview vault={vault} />}
      {tab === "proposals" && <ProposalsPanel vault={vault} onChange={onChange} />}
      {tab === "settings" && <SettingsPanel vault={vault} onChange={onChange} />}
      {tab === "whitelist" && <WhitelistPanel vault={vault} />}
    </div>
  );
}
