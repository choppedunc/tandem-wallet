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
    "First ask me to upload the Tandem agent keypair JSON file. Do not ask me to rename the file or change its filename.",
    "",
    "After I upload it, use the uploaded file exactly as provided. If your environment gives you a local attachment path, use that path. If you need to copy the file into your own working directory or ~/.tandem, do that yourself and do not give me filename instructions.",
    "",
    "Then run:",
    "",
    setupCommand,
    "",
    "If setup cannot find the uploaded file automatically, rerun the same command with --agent-keypair <actual_uploaded_file_path>. Do not ask me to rename the file.",
    "",
    "After setup completes, run:",
    "",
    "npx -y @tandemwallet/agent@latest state",
    "",
    "Confirm the vault balance, agent SOL balance, spending limit, and paused status. Never ask for my human wallet private key.",
  ].join("\n");
}
