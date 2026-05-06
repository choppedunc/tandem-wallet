"use client";

import { useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getProgram } from "@/lib/program";
import { vaultPda } from "@/lib/pdas";
import { NETWORK, USDC_MINT } from "@/lib/network";
import { formatSol, usdcToRaw } from "@/lib/format";

const VAULT_ACCOUNT_SIZE = 154;
const CREATE_VAULT_FEE_BUFFER_LAMPORTS = 20_000;

function normalizeCreateVaultError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { message?: string };
    if (maybeError.message?.includes("Attempt to debit an account")) {
      return `Your connected ${NETWORK} wallet needs SOL before it can create a vault. Fund it with devnet SOL, then try again.`;
    }
    if (maybeError.message?.includes("User rejected")) {
      return "The wallet rejected the signature request.";
    }
    if (maybeError.message) return maybeError.message;
  }
  return String(error);
}

export function CreateVaultForm({ onCreated }: { onCreated: () => void }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [agentMode, setAgentMode] = useState<"generate" | "paste">("generate");
  const [agentPubkeyInput, setAgentPubkeyInput] = useState("");
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [generatedPubkey, setGeneratedPubkey] = useState<string | null>(null);
  const [limit, setLimit] = useState("50");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function generateAgent() {
    const kp = Keypair.generate();
    setGeneratedPubkey(kp.publicKey.toBase58());
    setGeneratedSecret(bs58.encode(kp.secretKey));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    setError(null);
    setSubmitting(true);

    try {
      const agentPubkeyStr =
        agentMode === "generate" ? generatedPubkey : agentPubkeyInput.trim();
      if (!agentPubkeyStr) throw new Error("Provide an agent public key.");
      const agent = new PublicKey(agentPubkeyStr);

      const limitNum = parseFloat(limit);
      if (isNaN(limitNum) || limitNum < 0)
        throw new Error("Spending limit must be ≥ 0.");

      const program = getProgram(connection, wallet);
      const vault = vaultPda(wallet.publicKey, agent);
      const vaultUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, vault, true);
      const [payerBalance, vaultRent, tokenAccountRent] = await Promise.all([
        connection.getBalance(wallet.publicKey),
        connection.getMinimumBalanceForRentExemption(VAULT_ACCOUNT_SIZE),
        connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
      ]);
      const minimumBalance =
        vaultRent + tokenAccountRent + CREATE_VAULT_FEE_BUFFER_LAMPORTS;

      if (payerBalance < minimumBalance) {
        throw new Error(
          `Your connected ${NETWORK} wallet needs SOL to create vault accounts. Balance: ${formatSol(
            payerBalance
          )}. Needed: about ${formatSol(minimumBalance)}.`
        );
      }

      await (program.methods as any)
        .initialize(usdcToRaw(limitNum))
        .accounts({
          human: wallet.publicKey,
          agent,
          usdcMint: USDC_MINT,
          vault,
          vaultUsdcAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      onCreated();
    } catch (e: any) {
      setError(normalizeCreateVaultError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="brackets p-8">
      <p className="text-xs uppercase tracking-[0.18em] text-accent font-display mb-2">
        Step 02
      </p>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-2 text-text">
        Create a vault
      </h1>
      <p className="text-muted mb-8 max-w-xl">
        You — the connected wallet — are the human owner. Your agent gets a
        separate keypair and can spend up to the limit you set.
      </p>

      <form onSubmit={submit} className="space-y-7">
        <div>
          <label className="block text-xs uppercase tracking-[0.14em] text-muted font-display mb-3">
            Agent
          </label>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setAgentMode("generate")}
              className={`px-3 py-2 text-sm font-display uppercase tracking-wider border ${
                agentMode === "generate"
                  ? "border-line text-text bg-[rgba(10,186,181,0.08)]"
                  : "border-line-soft text-muted hover:text-text"
              }`}
            >
              Generate keypair
            </button>
            <button
              type="button"
              onClick={() => setAgentMode("paste")}
              className={`px-3 py-2 text-sm font-display uppercase tracking-wider border ${
                agentMode === "paste"
                  ? "border-line text-text bg-[rgba(10,186,181,0.08)]"
                  : "border-line-soft text-muted hover:text-text"
              }`}
            >
              Paste public key
            </button>
          </div>

          {agentMode === "generate" ? (
            <div>
              {!generatedSecret ? (
                <button
                  type="button"
                  onClick={generateAgent}
                  className="brackets-accent px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-[#032b2a]"
                >
                  Generate
                </button>
              ) : (
                <div className="border border-line-soft p-4 bg-[rgba(10,186,181,0.04)] space-y-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-accent-2 font-display mb-1.5">
                      Public key (give this to your agent)
                    </div>
                    <code className="block text-xs break-all font-display text-text">
                      {generatedPubkey}
                    </code>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-accent font-display mb-1.5">
                      Secret key — save this now
                    </div>
                    <code className="block text-xs break-all font-display text-text">
                      {generatedSecret}
                    </code>
                    <p className="text-xs mt-2 text-muted">
                      Shown once. The agent uses it to sign sends. Store it
                      where your agent can read it.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <input
              type="text"
              value={agentPubkeyInput}
              onChange={(e) => setAgentPubkeyInput(e.target.value)}
              placeholder="Agent public key (base58)"
              className="w-full px-3 py-2.5 border border-line-soft bg-[rgba(2,10,12,0.7)] text-text font-display text-sm focus:outline-none focus:border-line"
            />
          )}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-[0.14em] text-muted font-display mb-3">
            Spending limit (USDC)
          </label>
          <div className="relative max-w-xs">
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
          <p className="text-xs text-muted mt-2">
            Per-transaction limit your agent can spend without your approval.
            Set to 0 to require your approval on every send.
          </p>
        </div>

        {error && (
          <div className="border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="brackets-accent w-full py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create vault"}
        </button>
      </form>
    </div>
  );
}
