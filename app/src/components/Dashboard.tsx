"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getProgram } from "@/lib/program";
import { CreateVaultForm } from "./CreateVaultForm";
import { VaultDetail, type VaultData } from "./VaultDetail";

export function Dashboard() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [vaults, setVaults] = useState<VaultData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const refresh = useCallback(async () => {
    if (!program || !wallet) return;
    setLoading(true);
    setError(null);
    try {
      const accounts = await (program.account as any).vault.all([
        { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
      ]);
      const mapped: VaultData[] = accounts.map((a: any) => ({
        address: a.publicKey as PublicKey,
        human: a.account.human as PublicKey,
        agent: a.account.agent as PublicKey,
        usdcMint: a.account.usdcMint as PublicKey,
        vaultUsdcAta: a.account.vaultUsdcAta as PublicKey,
        spendingLimit: a.account.spendingLimit as BN,
        paused: a.account.paused as boolean,
        proposalCount: a.account.proposalCount as BN,
      }));
      setVaults(mapped);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [program, wallet]);

  useEffect(() => {
    if (program && wallet) refresh();
    else setVaults(null);
  }, [program, wallet, refresh]);

  if (!wallet) {
    return (
      <div className="brackets p-12 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-display mb-3">
          Step 01
        </p>
        <h1 className="font-display text-3xl md:text-4xl font-bold mb-3 text-text">
          Connect your wallet
        </h1>
        <p className="text-muted max-w-md mx-auto">
          Connect a Solana wallet to view, create, and govern your Tandem Wallet vault.
        </p>
      </div>
    );
  }

  if (loading && !vaults) {
    return (
      <div className="text-muted text-sm font-display tracking-wider uppercase">
        Loading vaults…
      </div>
    );
  }

  if (error) {
    return (
      <div className="brackets p-6">
        <p className="text-accent-2 text-sm">{error}</p>
        <button
          onClick={refresh}
          className="mt-3 text-sm font-semibold text-accent hover:text-accent-2 underline underline-offset-4"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!vaults || vaults.length === 0) {
    return <CreateVaultForm onCreated={refresh} />;
  }

  return <VaultDetail vault={vaults[0]} onChange={refresh} />;
}
