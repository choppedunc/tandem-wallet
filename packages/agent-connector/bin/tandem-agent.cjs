#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PublicKey } = require("@solana/web3.js");
const {
  DEFAULT_PROGRAM_ID,
  DEFAULT_RPC_URL,
  clientFromConfig,
  defaultConfigPath,
  expandPath,
  writePrivateJson,
} = require("../src/index.cjs");

const repoRoot = path.resolve(__dirname, "../../..");
const mcpServerPath = path.join(__dirname, "tandem-agent-mcp.cjs");
const instructionFileName = "TANDEM_AGENT_INSTRUCTIONS.md";

function usage() {
  console.log(`Tandem Wallet Agent Connector

Usage:
  tandem-agent setup --vault <vault> --agent-keypair <path> [--rpc-url <url>] [--program-id <id>]
  tandem-agent state [--config <path>]
  tandem-agent send --recipient <wallet> --amount <usdc> [--vault <vault>] [--config <path>]
  tandem-agent propose --recipient <wallet> --amount <usdc> [--memo <text>] [--vault <vault>] [--config <path>]
  tandem-agent proposals [--vault <vault>] [--limit <n>] [--config <path>]
  tandem-agent mcp [--config <path>]

The connector stores only config and a keypair file path. Do not put mainnet
keypair files inside this repository.`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) {
      args._.push(part);
      continue;
    }

    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function assertPublicKey(label, value) {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${label} must be a valid Solana public key.`);
  }
}

function isInsideRepo(filePath) {
  const relative = path.relative(repoRoot, expandPath(filePath));
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function agentInstructions({ vault, rpcUrl, programId }) {
  return `# Tandem Wallet Agent Instructions

Use Tandem Wallet tools for USDC payments from this vault:

- Vault: ${vault}
- Program: ${programId}
- RPC: ${rpcUrl}

Rules:

- Never ask the human to paste or reveal a private key.
- Never print, log, summarize, or expose private key material.
- Before sending, call get_vault_state and check the vault is not paused.
- For payments within allowance, call send_usdc.
- For payments above allowance, call create_proposal and wait for human review.
- If send_usdc says the amount exceeds the spending limit, do not retry smaller chunks unless the human explicitly asks. Create a proposal instead.
- Treat recipient wallet addresses and amounts as security-critical. Confirm they came from the user's current request or trusted application context.
- If a transaction fails or the recipient USDC account is missing, report the exact error and stop.
`;
}

function mcpConfigSnippet(configPath) {
  return {
    "tandem-wallet": {
      command: "node",
      args: [mcpServerPath],
      env: {
        TANDEM_AGENT_CONFIG: configPath,
      },
    },
  };
}

async function setup(args) {
  const vault = assertPublicKey("vault", args.vault);
  const rpcUrl =
    args["rpc-url"] || process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC_URL;
  const programId = assertPublicKey(
    "program-id",
    args["program-id"] ||
      process.env.NEXT_PUBLIC_PROGRAM_ID ||
      DEFAULT_PROGRAM_ID
  );
  const configPath = expandPath(args.config || defaultConfigPath());
  const agentKeypairPath = args["agent-keypair"];

  if (!agentKeypairPath) {
    throw new Error(
      "--agent-keypair is required. Use a local keypair file outside this repo."
    );
  }

  const expandedKeypairPath = expandPath(agentKeypairPath);
  if (!fs.existsSync(expandedKeypairPath)) {
    throw new Error(
      `Agent keypair file does not exist: ${expandedKeypairPath}`
    );
  }
  if (isInsideRepo(expandedKeypairPath) && !args["allow-repo-keypair"]) {
    throw new Error(
      "Refusing to use an agent keypair inside this repo. Move it to ~/.tandem or pass --allow-repo-keypair for devnet only."
    );
  }

  const config = {
    rpcUrl,
    programId,
    vault,
    agentKeypairPath: expandedKeypairPath,
    createdAt: new Date().toISOString(),
  };
  writePrivateJson(configPath, config);

  const instructionPath = path.join(
    path.dirname(configPath),
    instructionFileName
  );
  fs.writeFileSync(instructionPath, agentInstructions(config));
  fs.chmodSync(instructionPath, 0o600);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        configPath,
        instructionPath,
        vault,
        programId,
        rpcUrl,
        mcpServer: mcpConfigSnippet(configPath),
      },
      null,
      2
    )
  );
}

function loadClient(args) {
  const { client, config } = clientFromConfig(
    args.config || defaultConfigPath()
  );
  return { client, config };
}

function resolveVault(args, config) {
  const vault = args.vault || config.vault;
  if (!vault)
    throw new Error(
      "Vault is required. Pass --vault or run tandem-agent setup."
    );
  return vault;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "setup") {
    await setup(args);
    return;
  }

  if (command === "mcp") {
    process.env.TANDEM_AGENT_CONFIG = expandPath(
      args.config || defaultConfigPath()
    );
    require("./tandem-agent-mcp.cjs");
    return;
  }

  const { client, config } = loadClient(args);
  const vault = resolveVault(args, config);

  if (command === "state") {
    console.log(JSON.stringify(await client.getVaultState(vault), null, 2));
    return;
  }

  if (command === "send") {
    if (!args.recipient || !args.amount) {
      throw new Error(
        "send requires --recipient <wallet> and --amount <usdc>."
      );
    }
    console.log(
      JSON.stringify(
        await client.sendUsdc({
          vault,
          recipient: args.recipient,
          amountUsdc: args.amount,
          allowWhitelisted: Boolean(args.whitelisted),
        }),
        null,
        2
      )
    );
    return;
  }

  if (command === "propose") {
    if (!args.recipient || !args.amount) {
      throw new Error(
        "propose requires --recipient <wallet> and --amount <usdc>."
      );
    }
    console.log(
      JSON.stringify(
        await client.createProposal({
          vault,
          recipient: args.recipient,
          amountUsdc: args.amount,
          memo: args.memo || "Tandem Wallet agent request",
        }),
        null,
        2
      )
    );
    return;
  }

  if (command === "proposals") {
    console.log(
      JSON.stringify(
        await client.listProposals({
          vault,
          limit: Number(args.limit || 10),
        }),
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
