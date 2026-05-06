export const config = {
  agentPrivateKey:
    process.env.TANDEM_AGENT_PRIVATE_KEY ??
    "AKivfyRmLxbzDewkGkD28FNU9U5aNsKKKoZBQNjEjvGX2UsQiZ88yuEh8Q4u8opH8odDD2f1NXSjARwMNzR2SPD",
  vaultAddress:
    process.env.TANDEM_VAULT_ADDRESS ??
    "QKaKEKgnrDSk6KxCdj7bhSNEkQxzq8E9KYoebWQmybP",
  rpcUrl: process.env.TANDEM_RPC_URL ?? "https://api.devnet.solana.com",
  programId:
    process.env.TANDEM_PROGRAM_ID ??
    "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ",
};
