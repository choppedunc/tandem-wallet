import { getProgram, getVaultAddress, getConnection, getAgentKeypair, getProgramId, getProtocolConfigAddress } from "./lib/client";
import { usdcToRaw, formatUsdc } from "./lib/format";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(JSON.stringify({ error: "Usage: send-usdc.ts <recipient> <amount>" }));
    process.exit(1);
  }

  const recipientAddress = new PublicKey(args[0]);
  const amount = parseFloat(args[1]);
  const rawAmount = usdcToRaw(amount);
  const program = getProgram();
  const connection = getConnection();
  const vaultAddress = getVaultAddress();
  const agentKeypair = getAgentKeypair();
  const programId = getProgramId();

  const vault = await (program.account as any).vault.fetch(vaultAddress);

  // Fetch protocol config for fee accounts
  const protocolConfigAddress = getProtocolConfigAddress();
  const protocolConfig = await (program.account as any).protocolConfig.fetch(protocolConfigAddress);

  // Get or create recipient ATA
  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection, agentKeypair, new PublicKey(vault.usdcMint), recipientAddress
  );

  // Check whitelist
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), vaultAddress.toBuffer(), recipientAddress.toBuffer()],
    programId
  );

  let whitelistEntry: PublicKey | null = null;
  try {
    await (program.account as any).whitelistEntry.fetch(whitelistPda);
    whitelistEntry = whitelistPda;
  } catch {
    // Not whitelisted
  }

  const spendingLimit = Number(vault.spendingLimit);
  const rawAmountNum = Number(rawAmount);

  // If over the spending limit and not whitelisted, create a proposal
  if (!whitelistEntry && rawAmountNum > spendingLimit) {
    console.log(JSON.stringify({
      action: "proposing",
      reason: "Amount exceeds spending limit. Creating proposal for human approval.",
      amount: formatUsdc(rawAmount),
      spendingLimit: formatUsdc(spendingLimit),
    }, null, 2));

    const proposalId = vault.proposalCount;
    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), vaultAddress.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
      programId
    );

    const tx = await (program.methods as any)
      .propose(new BN(rawAmount.toString()), `Send ${amount} USDC to ${recipientAddress.toBase58().slice(0, 8)}...`)
      .accounts({
        agent: agentKeypair.publicKey,
        vault: vaultAddress,
        recipient: recipientAddress,
        recipientAta: recipientAta.address,
        proposal: proposalPda,
        systemProgram: PublicKey.default,
      })
      .signers([agentKeypair])
      .rpc();

    console.log(JSON.stringify({
      action: "proposed",
      proposalId: proposalId.toString(),
      recipient: recipientAddress.toBase58(),
      amount: formatUsdc(rawAmount),
      tx,
    }, null, 2));
    return;
  }

  // Execute send
  const tx = await (program.methods as any)
    .sendUsdc(new BN(rawAmount.toString()))
    .accounts({
      signer: agentKeypair.publicKey,
      vault: vaultAddress,
      vaultUsdcAta: new PublicKey(vault.vaultUsdcAta),
      recipientAta: recipientAta.address,
      whitelistEntry: whitelistEntry,
      protocolConfig: protocolConfigAddress,
      stakerRewardAta: new PublicKey(protocolConfig.stakerRewardAta),
      treasuryAta: new PublicKey(protocolConfig.treasuryAta),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([agentKeypair])
    .rpc();

  console.log(JSON.stringify({
    action: "sent",
    recipient: recipientAddress.toBase58(),
    amount: formatUsdc(rawAmount),
    whitelisted: !!whitelistEntry,
    tx,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
