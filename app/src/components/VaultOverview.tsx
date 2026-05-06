"use client";

import type { VaultData } from "./VaultDetail";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6 py-3 border-b border-line-soft last:border-b-0">
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display sm:w-32 shrink-0">
        {label}
      </div>
      <div className="font-display text-sm break-all text-text">{value}</div>
    </div>
  );
}

export function VaultOverview({ vault }: { vault: VaultData }) {
  return (
    <div className="brackets p-6">
      <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display mb-4">
        Vault details
      </p>
      <Row label="Vault PDA" value={vault.address.toBase58()} />
      <Row label="Human" value={vault.human.toBase58()} />
      <Row label="Agent" value={vault.agent.toBase58()} />
      <Row label="USDC mint" value={vault.usdcMint.toBase58()} />
      <Row label="USDC account" value={vault.vaultUsdcAta.toBase58()} />
      <Row label="Proposals created" value={vault.proposalCount.toString()} />
    </div>
  );
}
