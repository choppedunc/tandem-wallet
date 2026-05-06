import { getProgram, getVaultAddress, getConnection, getProtocolConfigAddress } from "./lib/client";
import { formatUsdc, formatSol, formatToken } from "./lib/format";
import { getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const program = getProgram();
  const connection = getConnection();
  const vaultAddress = getVaultAddress();

  const vault = await (program.account as any).vault.fetch(vaultAddress);
  const usdcBalance = await getAccount(connection, new PublicKey(vault.vaultUsdcAta));
  const solBalance = await connection.getBalance(vaultAddress);

  const result: Record<string, any> = {
    vault: vaultAddress.toBase58(),
    human: vault.human.toBase58(),
    agent: vault.agent.toBase58(),
    usdcMint: vault.usdcMint.toBase58(),
    spendingLimit: formatUsdc(vault.spendingLimit),
    paused: vault.paused,
    proposalCount: vault.proposalCount.toString(),
    usdcBalance: formatUsdc(usdcBalance.amount),
    solBalance: formatSol(solBalance),
  };

  // Fetch protocol config (may not exist yet)
  try {
    const protocolConfigAddress = getProtocolConfigAddress();
    const protocolConfig = await (program.account as any).protocolConfig.fetch(protocolConfigAddress);
    result.protocol = {
      feeBps: protocolConfig.feeBps,
      feePercent: `${(protocolConfig.feeBps / 100).toFixed(2)}%`,
      tandemMint: protocolConfig.tandemMint.toBase58(),
      totalStaked: protocolConfig.totalStaked.toString(),
      stakerRewardAta: protocolConfig.stakerRewardAta.toBase58(),
      buybackAta: protocolConfig.buybackAta.toBase58(),
    };
  } catch {
    result.protocol = "Not initialized";
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
