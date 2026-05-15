"use client";

import { useEffect, useMemo, useState } from "react";
import { NETWORK, PROGRAM_ID, RPC_URL } from "@/lib/network";
import { shortAddress } from "@/lib/format";
import type { VaultData } from "./VaultDetail";

function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
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
}: {
  label: string;
  value: string;
  copyLabel?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
          {label}
        </p>
        <CopyButton value={value} label={copyLabel} />
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

export function AgentConnectorPanel({ vault }: { vault: VaultData }) {
  const vaultAddress = vault.address.toBase58();
  const agentAddress = vault.agent.toBase58();
  const programId = PROGRAM_ID.toBase58();
  const defaultConfigPath = "~/.tandem/agent.json";
  const [appUrl, setAppUrl] = useState("http://localhost:3000");

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  const packageSetupCommand = useMemo(
    () =>
      [
        "npx -y @tandemwallet/agent@latest setup",
        `--vault ${vaultAddress}`,
        `--rpc-url ${RPC_URL}`,
        `--program-id ${programId}`,
        `--app-url ${appUrl}`,
      ].join(" "),
    [appUrl, programId, vaultAddress]
  );

  const localRepoCommand = useMemo(
    () =>
      [
        "npm run agent -- setup",
        `--vault ${vaultAddress}`,
        `--rpc-url ${RPC_URL}`,
        `--program-id ${programId}`,
        `--app-url ${appUrl}`,
      ].join(" "),
    [appUrl, programId, vaultAddress]
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
        "Use send_usdc for payments within allowance.",
        "Use create_proposal for payments above allowance.",
        "When create_proposal returns messageForHuman, send that to the human with the approval link.",
        "At the start of every new payment request, check any earlier pending proposal with get_proposal or list_proposals.",
        "Before saying a proposal is still pending, call get_proposal or list_proposals.",
        "The agent wallet needs a small SOL balance for transaction fees.",
        "Never ask for, print, or reveal private keys.",
      ].join(" "),
    [vaultAddress]
  );

  return (
    <div className="space-y-5">
      <section className="brackets p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-3 text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
              Connect agent
            </p>
            <h2 className="font-display text-2xl font-bold text-text">
              One command for agent setup
            </h2>
          </div>
          <div className="border border-line-soft px-3 py-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted font-display">
            {NETWORK}
          </div>
        </div>

        <p className="mb-5 max-w-2xl text-sm leading-relaxed text-muted">
          Give your agent the downloaded file named agent-keypair.json, then
          run this setup command in the agent environment. Setup verifies the
          keypair against this vault and imports it into the local Tandem
          folder when needed.
        </p>

        <CodeBlock
          label="Setup command"
          value={packageSetupCommand}
          copyLabel="Copy command"
        />

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
            <p className="font-display text-sm text-text">
              Auto-imported
            </p>
          </div>
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
              The agent signer can spend within the current vault policy limits.
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

      <section className="brackets p-6">
        <p className="mb-4 text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
          Connector details
        </p>
        <div className="mb-5">
          <DetailLine label="Vault PDA" value={vaultAddress} />
          <DetailLine label="Agent" value={agentAddress} />
          <DetailLine label="Program" value={programId} />
          <DetailLine label="RPC" value={RPC_URL} />
          <DetailLine label="App URL" value={appUrl} />
        </div>

        <div className="space-y-5">
          <CodeBlock label="Agent instruction" value={agentInstruction} />
          <details className="border border-line-soft p-4">
            <summary className="cursor-pointer font-display text-sm font-bold uppercase tracking-[0.14em] text-text">
              MCP configuration
            </summary>
            <div className="mt-4">
              <CodeBlock
                label="MCP config"
                value={mcpConfig}
                copyLabel="Copy config"
              />
            </div>
          </details>
          <details className="border border-line-soft p-4">
            <summary className="cursor-pointer font-display text-sm font-bold uppercase tracking-[0.14em] text-text">
              Local repo command
            </summary>
            <div className="mt-4">
              <CodeBlock
                label="Development command"
                value={localRepoCommand}
                copyLabel="Copy command"
              />
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
