#!/usr/bin/env node
const readline = require("readline");
const { clientFromConfig, defaultConfigPath } = require("../src/index.cjs");

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

const tools = [
  tool(
    "get_agent_address",
    "Return the local Tandem agent signer public key.",
    {}
  ),
  tool(
    "get_vault_state",
    "Fetch Tandem vault state, balances, allowance, and pause status.",
    {
      vault: {
        type: "string",
        description: "Vault PDA. Defaults to configured vault.",
      },
    }
  ),
  tool(
    "send_usdc",
    "Send USDC from the vault. Executes immediately when the amount is within allowance or the recipient is whitelisted on-chain. Creates the recipient USDC associated token account when needed. Fails only when approval is required.",
    {
      vault: {
        type: "string",
        description: "Vault PDA. Defaults to configured vault.",
      },
      recipient: {
        type: "string",
        description: "Recipient wallet public key.",
      },
      amount_usdc: {
        type: "string",
        description: "USDC amount, max 6 decimals.",
      },
      allow_whitelisted: {
        type: "boolean",
        description:
          "Whether to use an on-chain whitelist bypass when present. Defaults to true.",
      },
    },
    ["recipient", "amount_usdc"]
  ),
  tool(
    "create_proposal",
    "Create a human approval proposal for a non-whitelisted above-allowance USDC payment. Do not call this before trying send_usdc. Returns approvalUrl and messageForHuman to share with the human.",
    {
      vault: {
        type: "string",
        description: "Vault PDA. Defaults to configured vault.",
      },
      recipient: {
        type: "string",
        description: "Recipient wallet public key.",
      },
      amount_usdc: {
        type: "string",
        description: "USDC amount, max 6 decimals.",
      },
      memo: {
        type: "string",
        description: "Short payment reason shown to the human.",
      },
    },
    ["recipient", "amount_usdc"]
  ),
  tool(
    "get_proposal",
    "Fetch one proposal's current status. Use this before telling the human a proposal is still pending.",
    {
      vault: {
        type: "string",
        description: "Vault PDA. Defaults to configured vault.",
      },
      proposal: {
        type: "string",
        description: "Proposal PDA.",
      },
      proposal_id: {
        type: "string",
        description: "Numeric proposal id. Requires vault.",
      },
    }
  ),
  tool("list_proposals", "List recent proposals for the configured vault.", {
    vault: {
      type: "string",
      description: "Vault PDA. Defaults to configured vault.",
    },
    limit: {
      type: "number",
      description: "Number of recent proposals, max 50.",
    },
  }),
];

function load() {
  const { client, config } = clientFromConfig(
    process.env.TANDEM_AGENT_CONFIG || defaultConfigPath()
  );
  return { client, config };
}

function resolveVault(args, config) {
  const vault = args.vault || config.vault;
  if (!vault)
    throw new Error("Vault is required. Add vault to config or pass vault.");
  return vault;
}

function textResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

async function callTool(name, args = {}) {
  const { client, config } = load();
  const vault = () => resolveVault(args, config);

  if (name === "get_agent_address") {
    return textResult({ agent: client.agentKeypair.publicKey.toBase58() });
  }
  if (name === "get_vault_state") {
    return textResult(await client.getVaultState(vault()));
  }
  if (name === "send_usdc") {
    return textResult(
      await client.sendUsdc({
        vault: vault(),
        recipient: args.recipient,
        amountUsdc: args.amount_usdc,
        allowWhitelisted: args.allow_whitelisted !== false,
      })
    );
  }
  if (name === "create_proposal") {
    return textResult(
      await client.createProposal({
        vault: vault(),
        recipient: args.recipient,
        amountUsdc: args.amount_usdc,
        memo: args.memo || "Tandem Wallet agent request",
      })
    );
  }
  if (name === "get_proposal") {
    return textResult(
      await client.getProposal({
        vault: args.vault || config.vault,
        proposal: args.proposal,
        proposalId: args.proposal_id,
      })
    );
  }
  if (name === "list_proposals") {
    return textResult(
      await client.listProposals({ vault: vault(), limit: args.limit || 10 })
    );
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "tandem-wallet-agent", version: "0.1.0" },
    };
  }

  if (message.method === "tools/list") {
    return { tools };
  }

  if (message.method === "tools/call") {
    return callTool(message.params.name, message.params.arguments || {});
  }

  if (message.method === "notifications/initialized") {
    return undefined;
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
    const result = await handle(message);
    if (message.id !== undefined && result !== undefined) {
      send({ jsonrpc: "2.0", id: message.id, result });
    }
  } catch (error) {
    if (message && message.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: error.message || String(error) },
      });
    } else {
      process.stderr.write(`${error.message || error}\n`);
    }
  }
});
