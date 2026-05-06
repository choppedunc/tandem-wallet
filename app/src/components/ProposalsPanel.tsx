"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram } from "@/lib/program";
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const refresh = useCallback(async () => {
    if (!program) return;
    setError(null);
    try {
      const accts = await (program.account as any).proposal.all([
        { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
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
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [program, vault.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function approve(p: Proposal) {
    if (!program) return;
    setBusy(p.pda.toBase58());
    setError(null);
    try {
      const recipientAtaAccount = await connection.getAccountInfo(p.recipientAta);
      if (!recipientAtaAccount) {
        const expectedRecipientAta = getAssociatedTokenAddressSync(
          vault.usdcMint,
          p.recipient,
          true
        );
        if (!expectedRecipientAta.equals(p.recipientAta)) {
          throw new Error(
            "Recipient token account is missing and is not the expected associated token account."
          );
        }

        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet!.publicKey,
            p.recipientAta,
            p.recipient,
            vault.usdcMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        const latestBlockhash = await connection.getLatestBlockhash();
        tx.feePayer = wallet!.publicKey;
        tx.recentBlockhash = latestBlockhash.blockhash;
        const signedTx = await wallet!.signTransaction(tx);
        const signature = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          "confirmed"
        );
      }

      const protocolConfig = protocolConfigPda();
      const cfg = await (program.account as any).protocolConfig.fetch(protocolConfig);
      await (program.methods as any)
        .approveProposal()
        .accounts({
          human: wallet!.publicKey,
          vault: vault.address,
          proposal: p.pda,
          vaultUsdcAta: vault.vaultUsdcAta,
          recipientAta: p.recipientAta,
          protocolConfig,
          stakerRewardAta: cfg.stakerRewardAta,
          buybackAta: cfg.buybackAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      await refresh();
      onChange();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(p: Proposal) {
    if (!program) return;
    setBusy(p.pda.toBase58());
    setError(null);
    try {
      await (program.methods as any)
        .cancelProposal()
        .accounts({
          human: wallet!.publicKey,
          vault: vault.address,
          proposal: p.pda,
        })
        .rpc();
      await refresh();
      onChange();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  const visible = useMemo(() => {
    if (!proposals) return [];
    if (filter === "pending")
      return proposals.filter((p) => !p.executed && !p.cancelled);
    return proposals;
  }, [proposals, filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-1">
          <button
            onClick={() => setFilter("pending")}
            className={`px-3 py-1.5 text-xs font-display uppercase tracking-wider border ${
              filter === "pending"
                ? "border-line text-text bg-[rgba(10,186,181,0.08)]"
                : "border-line-soft text-muted hover:text-text"
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 text-xs font-display uppercase tracking-wider border ${
              filter === "all"
                ? "border-line text-text bg-[rgba(10,186,181,0.08)]"
                : "border-line-soft text-muted hover:text-text"
            }`}
          >
            All
          </button>
        </div>
        <button
          onClick={refresh}
          className="text-xs uppercase tracking-wider font-display text-muted hover:text-text"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
          {error}
        </div>
      )}

      {proposals === null ? (
        <div className="text-muted text-sm font-display tracking-wider uppercase">
          Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-dashed border-line-soft p-10 text-center text-sm text-muted">
          {filter === "pending"
            ? "No proposals waiting for your approval."
            : "No proposals yet."}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((p) => {
            const status = p.executed
              ? "executed"
              : p.cancelled
                ? "cancelled"
                : "pending";
            const isBusy = busy === p.pda.toBase58();
            const statusColor =
              status === "pending"
                ? "text-accent"
                : status === "executed"
                  ? "text-accent-2"
                  : "text-muted";
            return (
              <li
                key={p.pda.toBase58()}
                className="border border-line-soft p-5 bg-[rgba(3,17,19,0.7)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
                  <div className="flex items-baseline gap-3">
                    <span className="text-xs text-muted font-display">
                      #{p.proposalId.toString()}
                    </span>
                    <span className="font-display text-xl font-bold text-text">
                      {formatUsdc(p.amount)}
                    </span>
                    <span
                      className={`text-[0.65rem] uppercase tracking-[0.18em] font-display ${statusColor}`}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="text-xs text-muted font-display">
                    → {shortAddress(p.recipient.toBase58(), 6)}
                  </div>
                </div>
                {p.memo && (
                  <div className="text-sm text-muted mb-3">{p.memo}</div>
                )}
                {status === "pending" && (
                  <div className="flex gap-2 items-center mt-3">
                    <button
                      onClick={() => approve(p)}
                      disabled={isBusy || vault.paused}
                      className="brackets-accent px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
                    >
                      {isBusy ? "Working…" : "Approve"}
                    </button>
                    <button
                      onClick={() => cancel(p)}
                      disabled={isBusy}
                      className="px-4 py-2 text-xs font-display uppercase tracking-wider border border-line-soft text-text hover:border-line disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    {vault.paused && (
                      <span className="text-xs text-muted">
                        Unpause vault to approve
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
