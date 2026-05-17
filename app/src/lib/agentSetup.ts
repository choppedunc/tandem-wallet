import { PROGRAM_ID, RPC_URL } from "./network";

const KEYPAIR_DISCOVERY_COMMAND =
  'KEYPAIR_PATH="${TANDEM_AGENT_KEYPAIR:-$(find "$PWD" "$PWD/web" "$HOME/Downloads" "$HOME/.tandem" -maxdepth 1 \\( -name "tandem-agent-keypair*.json" -o -name "agent-keypair.json" \\) -type f -print -quit 2>/dev/null)}"; test -n "$KEYPAIR_PATH" || { echo "Tandem agent keypair file not found. Save tandem-agent-keypair*.json in the current folder, ./web, ~/Downloads, or ~/.tandem."; exit 1; };';

export function buildAgentSetupCommand({
  vaultAddress,
  appUrl,
}: {
  vaultAddress: string;
  appUrl: string;
}) {
  return [
    KEYPAIR_DISCOVERY_COMMAND,
    "npx -y @tandemwallet/agent@latest setup",
    `--vault ${vaultAddress}`,
    '--agent-keypair "$KEYPAIR_PATH"',
    `--rpc-url ${RPC_URL}`,
    `--program-id ${PROGRAM_ID.toBase58()}`,
    `--app-url ${appUrl}`,
  ].join(" ");
}
