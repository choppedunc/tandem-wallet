#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");
const {
  DEFAULT_APP_URL,
  DEFAULT_PROGRAM_ID,
  DEFAULT_RPC_URL,
  clientFromConfig,
  defaultConfigPath,
  expandPath,
  readKeypair,
  writePrivateJson,
} = require("../src/index.cjs");

const repoRoot = path.resolve(__dirname, "../../..");
const mcpServerPath = path.join(__dirname, "tandem-agent-mcp.cjs");
const instructionFileName = "TANDEM_AGENT_INSTRUCTIONS.md";
const defaultAgentKeypairFileName = "agent-keypair.json";
const tandemAgentKeypairFileName = "tandem-agent-keypair.json";
const defaultAgentKeypairPath = "~/.tandem/agent-keypair.json";

function usage() {
  console.log(`Tandem Wallet Agent Connector

Usage:
  tandem-agent setup --vault <vault> [--agent-keypair <path>] [--keep-keypair-path] [--rpc-url <url>] [--program-id <id>] [--app-url <url>]
  tandem-agent state [--config <path>]
  tandem-agent send --recipient <wallet> --amount <usdc> [--vault <vault>] [--config <path>]
  tandem-agent propose --recipient <wallet> --amount <usdc> [--memo <text>] [--vault <vault>] [--config <path>]
  tandem-agent proposal --proposal <proposal_pda> [--config <path>]
  tandem-agent proposal --proposal-id <id> [--vault <vault>] [--config <path>]
  tandem-agent proposals [--vault <vault>] [--limit <n>] [--config <path>]
  tandem-agent mcp [--config <path>]

The connector stores only config and a keypair file path. During setup it can
auto-import tandem-agent-keypair*.json or agent-keypair.json from the current
folder, ./web, ~/Downloads, or ~/.tandem. Do not put mainnet keypair files
inside this repository.`);
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

function uniquePaths(paths) {
  const seen = new Set();
  return paths
    .filter(Boolean)
    .map((candidate) => path.resolve(expandPath(candidate)))
    .filter((candidate) => {
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function keypairCandidatesInDir(dirPath) {
  const expanded = expandPath(dirPath);
  let entries;
  try {
    entries = fs.readdirSync(expanded, { withFileTypes: true });
  } catch {
    return [];
  }

  const tandemFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^tandem-agent-keypair(?:-.+)?\.json$/u.test(entry.name)
    )
    .map((entry) => path.join(expanded, entry.name))
    .sort();
  const legacyFile = path.join(expanded, defaultAgentKeypairFileName);

  return fs.existsSync(legacyFile) ? [...tandemFiles, legacyFile] : tandemFiles;
}

function setupKeypairCandidates(requestedPath) {
  const cwd = process.cwd();
  const searchDirs = [
    cwd,
    path.join(cwd, "web"),
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), ".tandem"),
  ];
  return uniquePaths([
    requestedPath,
    process.env.TANDEM_AGENT_KEYPAIR,
    ...searchDirs.flatMap(keypairCandidatesInDir),
    path.join(cwd, tandemAgentKeypairFileName),
    path.join(cwd, defaultAgentKeypairFileName),
    path.join(cwd, "web", tandemAgentKeypairFileName),
    path.join(cwd, "web", defaultAgentKeypairFileName),
    path.join(os.homedir(), "Downloads", tandemAgentKeypairFileName),
    path.join(os.homedir(), "Downloads", defaultAgentKeypairFileName),
    defaultAgentKeypairPath,
  ]);
}

function existingFiles(paths) {
  return paths.filter((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function copyPrivateFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o600);
}

function readKeypairPublicKey(filePath) {
  try {
    return readKeypair(filePath).publicKey.toBase58();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read agent keypair at ${filePath}: ${message}`);
  }
}

async function fetchVaultAgent(rpcUrl, vault) {
  const connection = new Connection(rpcUrl, "confirmed");
  const account = await connection.getAccountInfo(new PublicKey(vault));
  if (!account) {
    throw new Error(`Vault account not found: ${vault}`);
  }
  if (account.data.length < 72) {
    throw new Error(`Vault account has unexpected data length: ${vault}`);
  }
  return new PublicKey(account.data.subarray(40, 72)).toBase58();
}

async function resolveSetupAgentKeypair({ args, rpcUrl, vault }) {
  const requestedPath = expandPath(
    args["agent-keypair"] ||
      process.env.TANDEM_AGENT_KEYPAIR ||
      defaultAgentKeypairPath
  );
  const defaultKeypairPath = expandPath(defaultAgentKeypairPath);
  const requestedPathInsideRepo = isInsideRepo(requestedPath);
  const keepRequestedPath =
    args["keep-keypair-path"] ||
    path.resolve(requestedPath) === path.resolve(defaultKeypairPath);
  const targetPath =
    requestedPathInsideRepo && !args["allow-repo-keypair"]
      ? defaultKeypairPath
      : keepRequestedPath
        ? requestedPath
        : defaultKeypairPath;
  const candidates = setupKeypairCandidates(requestedPath);
  const existing = existingFiles(candidates);

  if (existing.length === 0) {
    throw new Error(
      [
        "Agent keypair file was not found.",
        `Save the downloaded Tandem keypair file in the agent's current folder, ./web, ~/Downloads, or ~/.tandem; then rerun setup.`,
        "You can also pass --agent-keypair <path>.",
        "Searched:",
        ...candidates.map((candidate) => `- ${candidate}`),
      ].join("\n")
    );
  }

  let expectedAgent = null;
  try {
    expectedAgent = await fetchVaultAgent(rpcUrl, vault);
  } catch {
    // If RPC is unavailable, fall back to the first readable candidate and let
    // later write actions enforce the signer/vault relationship.
  }

  let chosenPath = null;
  const found = [];

  for (const candidate of existing) {
    const publicKey = readKeypairPublicKey(candidate);
    found.push({ path: candidate, publicKey });
    if (!expectedAgent || publicKey === expectedAgent) {
      chosenPath = candidate;
      break;
    }
  }

  if (!chosenPath) {
    throw new Error(
      [
        `No matching agent keypair found. Vault expects agent ${expectedAgent}.`,
        "Found:",
        ...found.map((entry) => `- ${entry.path} (${entry.publicKey})`),
      ].join("\n")
    );
  }

  const shouldImport =
    path.resolve(chosenPath) !== path.resolve(targetPath) ||
    (isInsideRepo(chosenPath) && !args["allow-repo-keypair"]);

  if (isInsideRepo(chosenPath) && args["allow-repo-keypair"]) {
    return {
      agentKeypairPath: chosenPath,
      expectedAgent,
      importedFrom: null,
    };
  }

  if (shouldImport) {
    copyPrivateFile(chosenPath, targetPath);
    return {
      agentKeypairPath: targetPath,
      expectedAgent,
      importedFrom: chosenPath,
    };
  }

  if (isInsideRepo(chosenPath) && !args["allow-repo-keypair"]) {
    throw new Error(
      "Refusing to use an agent keypair inside this repo. Move it to ~/.tandem or pass --allow-repo-keypair for devnet only."
    );
  }

  fs.chmodSync(chosenPath, 0o600);
  return {
    agentKeypairPath: chosenPath,
    expectedAgent,
    importedFrom: null,
  };
}

function agentInstructions({ vault, rpcUrl, programId, appUrl }) {
  return `# Tandem Wallet Agent Instructions

Use Tandem Wallet tools for USDC payments from this vault:

- Vault: ${vault}
- Program: ${programId}
- RPC: ${rpcUrl}
- App: ${appUrl}

Rules:

- Never ask the human to paste or reveal a private key.
- Never print, log, summarize, or expose private key material.
- Before sending, call get_vault_state and check the vault is not paused.
- For every payment request, call send_usdc first. It executes immediately when the amount is within allowance or the recipient is whitelisted on-chain.
- Only call create_proposal after send_usdc says the amount exceeds the spending limit and no whitelist bypass applies.
- Proposal messages must include amount, recipient wallet address, memo, status, and approvalUrl.
- At the start of every new payment request, check any earlier proposal you believe is pending with get_proposal or list_proposals. Chain state is the source of truth, not chat memory.
- After creating a proposal, call get_proposal or list_proposals before telling the human it is still pending. Do not assume it is still pending after the human has had time to review it.
- If send_usdc says the amount exceeds the spending limit, do not retry smaller chunks unless the human explicitly asks. Create a proposal instead only when the recipient is not whitelisted.
- Treat recipient wallet addresses and amounts as security-critical. Confirm they came from the user's current request or trusted application context.
- The connector creates the recipient USDC associated token account when needed.
- If a transaction fails, report the exact error and stop.
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
  const appUrl =
    args["app-url"] ||
    process.env.TANDEM_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    DEFAULT_APP_URL;
  const programId = assertPublicKey(
    "program-id",
    args["program-id"] ||
      process.env.NEXT_PUBLIC_PROGRAM_ID ||
      DEFAULT_PROGRAM_ID
  );
  const configPath = expandPath(args.config || defaultConfigPath());
  const keypair = await resolveSetupAgentKeypair({ args, rpcUrl, vault });

  const config = {
    rpcUrl,
    appUrl,
    programId,
    vault,
    agentKeypairPath: keypair.agentKeypairPath,
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
        appUrl,
        agent: keypair.expectedAgent,
        agentKeypairPath: keypair.agentKeypairPath,
        importedKeypairFrom: keypair.importedFrom,
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
          allowWhitelisted: args["no-whitelist"] !== true,
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

  if (command === "proposal") {
    if (!args.proposal && !args["proposal-id"]) {
      throw new Error(
        "proposal requires --proposal <proposal_pda> or --proposal-id <id>."
      );
    }
    console.log(
      JSON.stringify(
        await client.getProposal({
          vault,
          proposal: args.proposal,
          proposalId: args["proposal-id"],
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
