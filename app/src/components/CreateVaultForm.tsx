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
      data-onboarding="agent-keypair-download"
      className="inline-flex shrink-0 items-center gap-2 border border-line bg-[rgba(10,186,181,0.12)] px-4 py-2.5 text-[0.65rem] font-display uppercase tracking-[0.14em] text-text hover:bg-[rgba(10,186,181,0.18)] disabled:opacity-50"
    >
      {attention ? <AttentionPulse label="Download agent keypair" /> : null}
      <span>Download Keypair JSON</span>
    </button>
  );
}

export function CreateVaultForm({
  onCreated,
  onAgentGenerated,
  onAgentKeypairDownloaded,
  onAgentModeChange,
  onCreateRequested,
}: {
  onCreated: (vault: PublicKey, name: string) => void;
  onAgentGenerated?: () => void;
  onAgentKeypairDownloaded?: () => void;
  onAgentModeChange?: (mode: "generate" | "paste") => void;
  onCreateRequested?: () => void;
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
  const [existingAgentConfirmed, setExistingAgentConfirmed] = useState(false);
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
    onAgentGenerated?.();
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
      if (agent.equals(wallet.publicKey)) {
        throw new Error("Use a separate agent wallet from your human wallet.");
      }
      if (agentMode === "paste" && !existingAgentConfirmed) {
        throw new Error(
          "Confirm that your agent controls this wallet before creating the vault."
        );
      }

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
      setExistingAgentConfirmed(false);
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
    onCreateRequested?.();
    if (agentMode === "generate" && generatedPubkey && generatedSecret) {
      setError(null);
      setConfirmationStep("stored");
      return;
    }
    void createVault();
  }

  const createVaultDisabled =
    submitting ||
    (agentMode === "generate" && !generatedPubkey) ||
    (agentMode === "paste" &&
      (!agentPubkeyInput.trim() || !existingAgentConfirmed));

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
        <div data-onboarding="vault-name">
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

        <div data-onboarding="spending-limit">
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
            Set to 0 to require your approval on every send. You can change
            this limit at any time from the dashboard.
          </p>
        </div>

        <div data-onboarding="agent-keypair">
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
                setExistingAgentConfirmed(false);
                onAgentModeChange?.("generate");
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
                setExistingAgentConfirmed(false);
                onAgentModeChange?.("paste");
              }}
              className={`px-3 py-2 text-sm font-display uppercase tracking-wider border ${
                agentMode === "paste"
                  ? "border-line text-text bg-[rgba(10,186,181,0.08)]"
                  : "border-line-soft text-muted hover:text-text"
              }`}
            >
              Paste Existing Agent Public Key
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
                <div className="space-y-4 border border-line-soft bg-[rgba(10,186,181,0.04)] p-4 text-sm">
                  <div className="border border-line bg-[rgba(10,186,181,0.07)] p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-accent font-display">
                          Tandem agent keypair
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                          Download this file and give it to your agent, or
                          store it somewhere your agent can access. Tandem
                          setup will find, verify, and import it. Alternatively,
                          you can manually save the keypair from Advanced:
                          backup keys below.
                        </p>
                      </div>
                      <DownloadKeypairButton
                        value={generatedKeypairJson}
                        publicKey={generatedPubkey}
                        attention={!generatedKeypairSaved}
                        onDownload={() => {
                          setGeneratedKeypairSaved(true);
                          onAgentKeypairDownloaded?.();
                        }}
                      />
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      Shown once and cleared after vault creation. Tandem does
                      not store this key.
                    </p>
                  </div>
                  <div>
                    <details className="mt-3 border border-line-soft p-3">
                      <summary className="cursor-pointer font-display text-[0.65rem] font-bold uppercase tracking-[0.14em] text-muted">
                        Advanced: backup keys
                      </summary>
                      <div className="mt-3 space-y-4">
                        <div>
                          <div className="mb-1.5 text-xs uppercase tracking-[0.14em] text-accent font-display">
                            Downloaded file name
                          </div>
                          <code className="block break-all font-display text-xs text-text">
                            {generatedKeypairFileName}
                          </code>
                        </div>
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
                        <div className="space-y-3 border-t border-line-soft pt-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="mb-1.5 text-xs uppercase tracking-[0.14em] text-accent font-display">
                                Manual save option
                              </div>
                              <p className="text-xs leading-relaxed text-muted">
                                If you prefer not to use a browser download,
                                copy the raw JSON, paste it into a plain-text
                                editor, and save it as{" "}
                                <code className="break-all font-display text-text">
                                  {generatedKeypairFileName}
                                </code>
                                .
                              </p>
                            </div>
                            <CopyButton
                              value={generatedKeypairJson}
                              label="Copy JSON"
                              onCopy={() => setGeneratedKeypairSaved(true)}
                            />
                          </div>
                          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">
                            <li>
                              Use plain text only. In TextEdit, choose Format
                              &gt; Make Plain Text before saving.
                            </li>
                            <li>
                              Keep the filename ending in{" "}
                              <code className="font-display text-text">
                                .json
                              </code>
                              , then give that saved file to your agent.
                            </li>
                          </ul>
                        </div>
                        <p className="text-xs text-muted">
                          Keep all private key formats out of repos and chats.
                        </p>
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
                onChange={(e) => {
                  setAgentPubkeyInput(e.target.value);
                  setExistingAgentConfirmed(false);
                }}
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
              <label className="flex items-start gap-3 border border-line-soft bg-[rgba(58,23,25,0.28)] p-3 text-xs leading-relaxed text-muted">
                <input
                  type="checkbox"
                  checked={existingAgentConfirmed}
                  onChange={(event) =>
                    setExistingAgentConfirmed(event.target.checked)
                  }
                  className="mt-1 h-4 w-4 shrink-0 accent-[#49d4d0]"
                />
                <span>
                  I confirm the agent controls this wallet and can access the
                  matching Solana keypair file during setup.
                </span>
              </label>
            </div>
          )}
        </div>

        {error && (
          <div className="border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={createVaultDisabled}
          data-onboarding="create-vault"
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
