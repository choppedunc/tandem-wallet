import { getProgram, getConnection, getProtocolConfigAddress } from "./lib/client";
import { formatUsdc, formatToken } from "./lib/format";
import { getAccount, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const program = getProgram();
  const connection = getConnection();

  // Fetch protocol config
  const protocolConfigAddress = getProtocolConfigAddress();
  const protocolConfig = await (program.account as any).protocolConfig.fetch(protocolConfigAddress);

  const tandemMint = new PublicKey(protocolConfig.tandemMint);
  const stakerRewardAtaAddress = new PublicKey(protocolConfig.stakerRewardAta);
  const treasuryAtaAddress = new PublicKey(protocolConfig.treasuryAta);

  // Fetch TANDEM mint for decimals
  const mintInfo = await getMint(connection, tandemMint);

  // Fetch reward pool and treasury balances
  let rewardPoolBalance = "0.00 USDC";
  try {
    const rewardAccount = await getAccount(connection, stakerRewardAtaAddress);
    rewardPoolBalance = formatUsdc(rewardAccount.amount);
  } catch {
    // ATA may not exist yet
  }

  let treasuryBalance = "0.00 USDC";
  try {
    const treasuryAccount = await getAccount(connection, treasuryAtaAddress);
    treasuryBalance = formatUsdc(treasuryAccount.amount);
  } catch {
    // ATA may not exist yet
  }

  const result = {
    authority: protocolConfig.authority.toBase58(),
    feeBps: protocolConfig.feeBps,
    feePercent: `${(protocolConfig.feeBps / 100).toFixed(2)}%`,
    tandemMint: tandemMint.toBase58(),
    totalStaked: formatToken(protocolConfig.totalStaked, mintInfo.decimals, "TANDEM"),
    rewardPoolBalance,
    treasuryBalance,
    totalRewardsClaimed: formatUsdc(protocolConfig.totalRewardsClaimed),
    totalRewardsProcessed: formatUsdc(protocolConfig.totalRewardsProcessed),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
