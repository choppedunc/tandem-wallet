import { PROGRAM_ID, RPC_URL } from "./network";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildAgentSetupCommand({
  vaultAddress,
  appUrl,
}: {
  vaultAddress: string;
  appUrl: string;
}) {
  return [
    "npx -y @tandemwallet/agent@latest setup",
    `--vault ${shellQuote(vaultAddress)}`,
    `--rpc-url ${shellQuote(RPC_URL)}`,
    `--program-id ${shellQuote(PROGRAM_ID.toBase58())}`,
    `--app-url ${shellQuote(appUrl)}`,
  ].join(" ");
}

export function buildAgentSetupMessage({
  vaultAddress,
  appUrl,
}: {
  vaultAddress: string;
  appUrl: string;
}) {
  const setupCommand = buildAgentSetupCommand({ vaultAddress, appUrl });

  return [
    "Set up my Tandem Vault.",
    "",
    "First ask me for the Tandem agent keypair JSON file. After I send it, save it as tandem-agent-keypair.json in your working directory or ~/.tandem, then run:",
    "",
    setupCommand,
    "",
    "After setup completes, run:",
    "",
    "npx -y @tandemwallet/agent@latest state",
    "",
    "Confirm the vault balance, agent SOL balance, spending limit, and paused status. Never ask for my human wallet private key.",
  ].join("\n");
}
