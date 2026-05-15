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
import { protocolConfigPda, vaultPda } from "@/lib/pdas";
import { NETWORK, USDC_MINT } from "@/lib/network";
import { formatSol, usdcToRaw } from "@/lib/format";
import { fallbackVaultName } from "@/lib/vaultNames";
import { AttentionPulse } from "./AttentionPulse";

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

function CopyButton({
  value,
  label,
  onCopy,
}: {
  value: string | null;
  label: string;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    onCopy?.();
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!value}
      className="shrink-0 border border-line-soft px-3 py-1.5 text-[0.65rem] font-display uppercase tracking-[0.14em] text-muted hover:border-line hover:text-text disabled:opacity-50"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function agentKeypairFileName(publicKey: string | null) {
  if (!publicKey) return "tandem-agent-keypair.json";
  return `tandem-agent-keypair-${publicKey.slice(0, 4)}-${publicKey.slice(
    -4
  )}.json`;
}

function DownloadKeypairButton({
  value,
  publicKey,
  attention,
  onDownload,
}: {
  value: string | null;
  publicKey: string | null;
  attention?: boolean;
  onDownload?: () => void;
}) {
  function download() {
    if (!value) return;
    const blob = new Blob([`${value}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = agentKeypairFileName(publicKey);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onDownload?.();
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={!value}
      className="inline-flex shrink-0 items-center gap-2 border border-line-soft px-3 py-1.5 text-[0.65rem] font-display uppercase tracking-[0.14em] text-muted hover:border-line hover:text-text disabled:opacity-50"
    >
      {attention ? <AttentionPulse label="Download agent keypair" /> : null}
      <span>Download JSON</span>
    </button>
  );
}

export function CreateVaultForm({
  onCreated,
}: {
  onCreated: (vault: PublicKey, name: string) => void;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [vaultName, setVaultName] = useState("");
  const [agentMode, setAgentMode] = useState<"generate" | "paste">("generate");
  const [agentPubkeyInput, setAgentPubkeyInput] = useState("");
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [generatedKeypairJson, setGeneratedKeypairJson] = useState<string | null>(
    null
  );
  const [generatedPubkey, setGeneratedPubkey] = useState<string | null>(null);
  const [limit, setLimit] = useState("50");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationStep, setConfirmationStep] = useState<
    "stored" | "risk" | null
  >(null);
  const [generatedKeypairSaved, setGeneratedKeypairSaved] = useState(false);
  const generatedKeypairFileName = agentKeypairFileName(generatedPubkey);

  function clearGeneratedAgent() {
    setGeneratedPubkey(null);
    setGeneratedSecret(null);
    setGeneratedKeypairJson(null);
    setGeneratedKeypairSaved(false);
  }

  function generateAgent() {
    const kp = Keypair.generate();
    setGeneratedPubkey(kp.publicKey.toBase58());
    setGeneratedSecret(bs58.encode(kp.secretKey));
    setGeneratedKeypairJson(JSON.stringify(Array.from(kp.secretKey), null, 2));
    setGeneratedKeypairSaved(false);
  }

  async function createVault() {
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
      const protocolConfig = protocolConfigPda();
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

      await program.methods
        .initialize(usdcToRaw(limitNum))
        .accounts({
          human: wallet.publicKey,
          agent,
          usdcMint: USDC_MINT,
          protocolConfig,
          vault,
          vaultUsdcAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      onCreated(vault, vaultName.trim() || fallbackVaultName(vault));
      setGeneratedSecret(null);
      setGeneratedKeypairJson(null);
      setGeneratedPubkey(null);
      setGeneratedKeypairSaved(false);
      setAgentPubkeyInput("");
      setVaultName("");
    } catch (error) {
      setError(normalizeCreateVaultError(error));
    } finally {
      setSubmitting(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (agentMode === "generate" && generatedPubkey && generatedSecret) {
      setError(null);
      setConfirmationStep("stored");
      return;
    }
    void createVault();
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
            Vault name
          </label>
          <input
            type="text"
            value={vaultName}
            onChange={(e) => setVaultName(e.target.value)}
            placeholder="Operations agent"
            className="w-full px-3 py-2.5 border border-line-soft bg-[rgba(2,10,12,0.7)] text-text font-display text-sm focus:outline-none focus:border-line"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-[0.14em] text-muted font-display mb-3">
            Agent
          </label>
          <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">
            Generate a new Tandem agent wallet, or paste an existing agent
            wallet public key. Existing wallets work only if your agent can
            sign with the matching Solana keypair file during setup.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAgentMode("generate");
                setAgentPubkeyInput("");
              }}
              className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-display uppercase tracking-wider border ${
                agentMode === "generate"
                  ? "border-line text-text bg-[rgba(10,186,181,0.08)]"
                  : "border-line-soft text-muted hover:text-text"
              }`}
            >
              <span>Generate Keypair</span>
              <span className="border border-line-soft bg-[rgba(10,186,181,0.12)] px-2 py-0.5 text-[0.55rem] tracking-[0.14em] text-accent-2">
                Recommended
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAgentMode("paste");
                clearGeneratedAgent();
              }}
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
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-accent-2 font-display">
                        Public key
                      </div>
                      <CopyButton value={generatedPubkey} label="Copy" />
                    </div>
                    <code className="block text-xs break-all font-display text-text">
                      {generatedPubkey}
                    </code>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-accent font-display">
                        Private key (base58)
                      </div>
                      <CopyButton value={generatedSecret} label="Copy" />
                    </div>
                    <code className="block text-xs break-all font-display text-text">
                      {generatedSecret}
                    </code>
                  </div>
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-accent font-display">
                          Tandem agent keypair
                        </div>
                        <div className="mt-1 break-all font-display text-[0.68rem] text-muted">
                          {generatedKeypairFileName}
                        </div>
                      </div>
                      <DownloadKeypairButton
                        value={generatedKeypairJson}
                        publicKey={generatedPubkey}
                        attention={!generatedKeypairSaved}
                        onDownload={() => setGeneratedKeypairSaved(true)}
                      />
                    </div>
                    <code className="block max-h-24 overflow-auto border border-line-soft bg-black/20 p-3 text-xs font-display text-text">
                      {generatedKeypairJson}
                    </code>
                    <p className="text-xs mt-2 text-muted">
                      Shown once and cleared after vault creation. Tandem does
                      not store this key. Download this file and give it to the
                      machine running your agent; setup will find, verify, and
                      import it. Keep the base58 private key as a backup, and
                      keep both formats out of repos and chats.
                    </p>
                    <details className="mt-3 border border-line-soft p-3">
                      <summary className="cursor-pointer font-display text-[0.65rem] font-bold uppercase tracking-[0.14em] text-muted">
                        Advanced: copy raw JSON
                      </summary>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-muted">
                          Use this only if your agent cannot receive file
                          uploads. Save the copied text as the exact JSON file
                          shown above.
                        </p>
                        <CopyButton
                          value={generatedKeypairJson}
                          label="Copy JSON"
                          onCopy={() => setGeneratedKeypairSaved(true)}
                        />
                      </div>
                    </details>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                value={agentPubkeyInput}
                onChange={(e) => setAgentPubkeyInput(e.target.value)}
                placeholder="Agent public key (base58)"
                className="w-full px-3 py-2.5 border border-line-soft bg-[rgba(2,10,12,0.7)] text-text font-display text-sm focus:outline-none focus:border-line"
              />
              <div className="flex items-start gap-3 border border-line bg-[rgba(10,186,181,0.06)] p-3 text-xs leading-relaxed text-muted">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent font-display text-[0.7rem] font-bold text-accent"
                >
                  !
                </span>
                <p>
                  Only paste a public key if your agent already controls that
                  Solana wallet and can access its matching keypair file. If
                  the wallet is managed by a platform and your agent cannot
                  access that keypair, use Generate Keypair instead.
                </p>
              </div>
            </div>
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

      {confirmationStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="brackets max-w-lg p-6 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
            {confirmationStep === "stored" ? (
              <>
                <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-accent-2">
                  Agent key check
                </p>
                <h2 className="mb-3 font-display text-2xl font-bold text-text">
                  Have you stored the agent keypair?
                </h2>
                <p className="text-sm text-muted">
                  Confirm that the generated private key or keypair JSON file
                  has been saved somewhere safe that only your agent can read.
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirmationStep(null)}
                    className="border border-line-soft px-4 py-2 text-sm font-display uppercase tracking-[0.14em] text-muted hover:text-text"
                  >
                    Go back
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmationStep("risk")}
                    className="brackets-accent px-4 py-2 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a]"
                  >
                    Yes, stored
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-2 font-display text-[0.65rem] uppercase tracking-[0.18em] text-accent">
                  Final confirmation
                </p>
                <h2 className="mb-3 font-display text-2xl font-bold text-text">
                  Are you sure the agent key is stored?
                </h2>
                <p className="text-sm text-muted">
                  If this keypair is lost or misplaced, your agent will not be
                  able to make transactions from this vault. Your human wallet
                  can still move funds manually, but automation will stop until
                  you migrate to a new vault or agent.
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirmationStep(null)}
                    disabled={submitting}
                    className="border border-line-soft px-4 py-2 text-sm font-display uppercase tracking-[0.14em] text-muted hover:text-text disabled:opacity-50"
                  >
                    Review key
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmationStep(null);
                      void createVault();
                    }}
                    disabled={submitting}
                    className="brackets-accent px-4 py-2 text-sm font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
                  >
                    {submitting ? "Creating…" : "Create vault"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
