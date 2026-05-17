"use client";

import { useEffect, useMemo, useState } from "react";
import { NETWORK, PROGRAM_ID, RPC_URL } from "@/lib/network";
import { shortAddress } from "@/lib/format";
import { buildAgentSetupCommand } from "@/lib/agentSetup";
import type { VaultData } from "./VaultDetail";
import { AttentionPulse } from "./AttentionPulse";

function CopyButton({
  value,
  label = "Copy",
  onCopy,
}: {
  value: string;
  label?: string;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    onCopy?.();
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 border border-line-soft px-3 py-2 text-[0.65rem] uppercase tracking-[0.14em] text-accent-2 transition-colors hover:border-line hover:text-text"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function CodeBlock({
  label,
  value,
  copyLabel = "Copy",
  onCopy,
}: {
  label: string;
  value: string;
  copyLabel?: string;
  onCopy?: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
          {label}
        </p>
        <CopyButton value={value} label={copyLabel} onCopy={onCopy} />
      </div>
      <pre className="overflow-x-auto border border-line-soft bg-[rgba(2,10,12,0.78)] p-3 text-xs leading-relaxed text-text">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-line-soft py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-6">
      <div className="shrink-0 text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display sm:w-32">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1 break-all font-display text-sm text-text">
          {value}
        </div>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function InfoTooltip({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="group relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-soft text-[0.65rem] text-accent-2 transition-colors hover:border-line hover:text-text"
    >
      ?
      <span className="pointer-events-none absolute right-0 top-7 z-20 hidden w-64 border border-line-soft bg-[rgba(2,10,12,0.98)] p-3 font-sans text-xs normal-case leading-relaxed tracking-normal text-muted shadow-[0_12px_32px_rgba(0,0,0,0.45)] group-hover:block">
        {label}
      </span>
    </span>
  );
}

export function AgentConnectorPanel({
  vault,
  commandCopied = false,
  needsAgentSolTopUp = false,
  onCommandCopied,
}: {
  vault: VaultData;
  commandCopied?: boolean;
  needsAgentSolTopUp?: boolean;
  onCommandCopied?: () => void;
}) {
  const vaultAddress = vault.address.toBase58();
  const agentAddress = vault.agent.toBase58();
  const programId = PROGRAM_ID.toBase58();
  const defaultConfigPath = "~/.tandem/agent.json";
  const [appUrl, setAppUrl] = useState("http://localhost:3000");

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  const packageSetupCommand = useMemo(
    () => buildAgentSetupCommand({ vaultAddress, appUrl }),
    [appUrl, vaultAddress]
  );

  const mcpConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "tandem-wallet": {
              command: "npx",
              args: ["-y", "@tandemwallet/agent@latest", "mcp"],
              env: {
                TANDEM_AGENT_CONFIG: defaultConfigPath,
              },
            },
          },
        },
        null,
        2
      ),
    []
  );

  const agentInstruction = useMemo(
    () =>
      [
        `Use Tandem Wallet for USDC payments from vault ${vaultAddress}.`,
        "Call get_vault_state before payment attempts.",
        "Call send_usdc first for every payment. It executes immediately when the payment is within allowance or the recipient is whitelisted.",
        "Use create_proposal only when send_usdc says approval is required for a non-whitelisted recipient.",
        "When create_proposal returns messageForHuman, send that to the human with the approval link.",
        "At the start of every new payment request, check any earlier pending proposal with get_proposal or list_proposals.",
        "Before saying a proposal is still pending, call get_proposal or list_proposals.",
        "The agent wallet needs a small SOL balance for transaction fees.",
        "Never ask for, print, or reveal private keys.",
      ].join(" "),
    [vaultAddress]
  );

  const setupCommandContent = (
    <>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-muted">
        Run this setup command in the agent environment. Setup finds the
        agent keypair file, verifies it matches this vault, and imports the
        vault details for future payments. It also prints a short guide the
        agent can follow immediately.
      </p>

      <div
        className="mb-5 border border-line-soft bg-[rgba(2,10,12,0.52)] p-4 text-sm leading-relaxed text-muted"
        data-onboarding="agent-json-file"
      >
        If Tandem generated the agent wallet, give your agent the downloaded
        Tandem keypair file first. If you pasted an existing agent wallet,
        your agent needs that wallet&apos;s matching Solana keypair file. If
        the wallet is managed by a platform and your agent cannot access the
        keypair, create a new Tandem agent wallet instead.
      </div>

      {needsAgentSolTopUp && (
        <div className="mb-4 flex items-start gap-3 border border-line-soft bg-[rgba(58,23,25,0.42)] p-3">
          <AttentionPulse
            label="Agent wallet needs SOL"
            className="mt-1"
          />
          <div>
            <p className="font-display text-xs font-bold uppercase tracking-[0.14em] text-text">
              Agent wallet needs SOL
            </p>
            <p className="mt-1 text-sm text-muted">
              Top up the agent wallet before asking it to send or propose
              transactions.
            </p>
          </div>
        </div>
      )}

      {!commandCopied && (
        <div className="mb-3 flex items-center gap-2 text-sm text-muted">
          <AttentionPulse label="Copy setup command" />
          <span>Copy this command and send it to your agent.</span>
        </div>
      )}

      <div data-onboarding="agent-setup-command">
        <CodeBlock
          label="Setup command"
          value={packageSetupCommand}
          copyLabel="Copy command"
          onCopy={onCommandCopied}
        />
      </div>

      <div className="mt-5 grid gap-2 md:grid-cols-3">
        <div className="border border-line-soft bg-[rgba(3,17,19,0.62)] p-3">
          <p className="mb-1 text-[0.62rem] uppercase tracking-[0.16em] text-muted font-display">
            Vault
          </p>
          <p className="font-display text-sm text-text">
            {shortAddress(vaultAddress, 6)}
          </p>
        </div>
        <div className="border border-line-soft bg-[rgba(3,17,19,0.62)] p-3">
          <p className="mb-1 text-[0.62rem] uppercase tracking-[0.16em] text-muted font-display">
            Agent
          </p>
          <p className="font-display text-sm text-text">
            {shortAddress(agentAddress, 6)}
          </p>
        </div>
        <div className="border border-line-soft bg-[rgba(3,17,19,0.62)] p-3">
          <p className="mb-1 text-[0.62rem] uppercase tracking-[0.16em] text-muted font-display">
            Keypair
          </p>
          <p className="font-display text-sm text-text">Auto-imported</p>
        </div>
      </div>
    </>
  );

  const connectorDetailsContent = (
    <details className="border border-line-soft p-4">
      <summary className="flex cursor-pointer items-center justify-between gap-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-text">
        <span>Connector Details</span>
        <InfoTooltip label="Reference values for this vault connection. Most users do not need these unless they are debugging setup or configuring a custom agent environment." />
      </summary>
      <div className="mt-4">
        <DetailLine label="Vault PDA" value={vaultAddress} />
        <DetailLine label="Agent" value={agentAddress} />
        <DetailLine label="Program" value={programId} />
        <DetailLine label="RPC" value={RPC_URL} />
        <DetailLine label="App URL" value={appUrl} />
      </div>
    </details>
  );

  return (
    <div className="space-y-5">
      <section className="brackets p-6" data-onboarding="agent-json-file">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-3 text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
              Connection
            </p>
            <h2 className="font-display text-2xl font-bold text-text">
              Agent connection
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Use the setup command to connect your agent to this vault.
              Connector details are reference values for custom setups or
              debugging.
            </p>
          </div>
          <div className="border border-line-soft px-3 py-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
            {NETWORK}
          </div>
        </div>

        {!commandCopied ? (
          setupCommandContent
        ) : (
          <details
            className="border border-line-soft p-4"
            data-onboarding="agent-setup-command"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-text">
              <span>Agent Setup Command</span>
              <InfoTooltip label="Kept here in case you need to reconnect the agent, set it up on another machine, or copy the setup command again." />
            </summary>
            <div className="mt-4">
              {setupCommandContent}
            </div>
          </details>
        )}

        <div className="mt-5">{connectorDetailsContent}</div>
      </section>

      <section className="brackets p-6">
        <div className="mb-5">
          <p className="mb-3 text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
            Additional Agent Instruction
          </p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The setup command prints and saves these instructions automatically.
            Use this copy if you need to refresh an agent&apos;s context or review
            the payment rules manually.
          </p>
        </div>
        <div className="space-y-5">
          <details className="border border-line-soft p-4">
            <summary className="flex cursor-pointer items-center justify-between gap-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-text">
              <span>Guidance Prompt</span>
              <InfoTooltip label="Optional prompt text you can paste to your agent. It is not required for setup, but helps the agent understand how to use Tandem safely and when to ask the human for approval." />
            </summary>
            <div className="mt-4">
              <CodeBlock
                label="Guidance prompt"
                value={agentInstruction}
                copyLabel="Copy prompt"
              />
            </div>
          </details>
          <details className="border border-line-soft p-4">
            <summary className="flex cursor-pointer items-center justify-between gap-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-text">
              <span>MCP Configuration</span>
              <InfoTooltip label="Optional configuration for agents that support MCP tools. This lets the agent call Tandem actions as structured tools instead of relying only on terminal commands." />
            </summary>
            <div className="mt-4">
              <CodeBlock
                label="MCP config"
                value={mcpConfig}
                copyLabel="Copy config"
              />
            </div>
          </details>
        </div>
      </section>

      <section className="brackets p-6">
        <p className="mb-3 text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
          Agent safety
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="border border-line-soft p-4">
            <p className="mb-2 font-display text-sm font-bold text-text">
              Keep the key local
            </p>
            <p className="text-sm text-muted">
              Do not paste mainnet private keys into chats, prompts, or repo
              files.
            </p>
          </div>
          <div className="border border-line-soft p-4">
            <p className="mb-2 font-display text-sm font-bold text-text">
              Allowance still matters
            </p>
            <p className="text-sm text-muted">
              The agent signer can spend within the current vault policy limits,
              and can bypass that limit for whitelisted recipients. Other
              above-limit payments become proposals for human review.
            </p>
          </div>
          <div className="border border-line-soft p-4">
            <p className="mb-2 font-display text-sm font-bold text-text">
              Fund agent gas
            </p>
            <p className="text-sm text-muted">
              The agent wallet needs a small SOL balance for fees and recipient
              token account creation.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
