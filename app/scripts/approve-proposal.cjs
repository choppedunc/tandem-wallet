const anchor = require("@coral-xyz/anchor");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const { PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");

const idl = require("../src/lib/idl.json");

function readKeypair(filePath) {
  const expanded = filePath.replace(/^~/, os.homedir());
  return anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf8")))
  );
}

async function main() {
  const vaultAddressArg = process.argv[2] ?? process.env.TANDEM_VAULT_ADDRESS;
  const proposalIdArg = process.argv[3] ?? process.env.TANDEM_PROPOSAL_ID;
  if (!vaultAddressArg || proposalIdArg === undefined) {
    throw new Error("Usage: approve-proposal.cjs <vault_address> <proposal_id>");
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );
  const humanKeypair = readKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");
  const vaultAddress = new PublicKey(vaultAddressArg);
  const proposalId = new anchor.BN(proposalIdArg);

  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(humanKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);
  const [proposal] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), vaultAddress.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
    programId
  );
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );

  const vault = await program.account.vault.fetch(vaultAddress);
  const proposalAccount = await program.account.proposal.fetch(proposal);
  const config = await program.account.protocolConfig.fetch(protocolConfig);

  const signature = await program.methods
    .approveProposal()
    .accounts({
      human: humanKeypair.publicKey,
      vault: vaultAddress,
      proposal,
      vaultUsdcAta: vault.vaultUsdcAta,
      recipientAta: proposalAccount.recipientAta,
      protocolConfig,
      stakerRewardAta: config.stakerRewardAta,
      buybackAta: config.buybackAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(JSON.stringify({
    signature,
    vault: vaultAddress.toBase58(),
    proposal: proposal.toBase58(),
    proposalId: proposalId.toString(),
    recipient: proposalAccount.recipient.toBase58(),
    amountRaw: proposalAccount.amount.toString(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
