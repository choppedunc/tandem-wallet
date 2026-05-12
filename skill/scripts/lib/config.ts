function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} before running Tandem skill scripts.`);
  }
  return value;
}

export const config = {
  agentPrivateKey: requireEnv("TANDEM_AGENT_PRIVATE_KEY"),
  vaultAddress: requireEnv("TANDEM_VAULT_ADDRESS"),
  rpcUrl: process.env.TANDEM_RPC_URL ?? "https://api.devnet.solana.com",
  programId:
    process.env.TANDEM_PROGRAM_ID ??
    "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ",
};
