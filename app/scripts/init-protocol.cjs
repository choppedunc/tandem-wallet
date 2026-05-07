const anchor = require("@coral-xyz/anchor");
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} = require("@solana/spl-token");
const {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const idl = require("../src/lib/idl.json");

function readKeypair(filePath) {
  const expanded = filePath.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf8"))));
}

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );
  const usdcMint = new PublicKey(
    process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  );
  const feeBps = Number(process.env.PROTOCOL_FEE_BPS || "25");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error("PROTOCOL_FEE_BPS must be an integer between 0 and 10000");
  }
  const authorityKeypair = readKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");
  const treasuryOwner = new PublicKey(
    process.env.TREASURY_OWNER ||
      process.env.TREASURY_WALLET ||
      authorityKeypair.publicKey.toBase58()
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );

  const existing = await connection.getAccountInfo(protocolConfig);
  if (existing) {
    const config = await program.account.protocolConfig.fetch(protocolConfig);
    console.log(JSON.stringify({
      status: "exists",
      protocolConfig: protocolConfig.toBase58(),
      authority: config.authority.toBase58(),
      feeBps: config.feeBps,
      usdcMint: config.usdcMint.toBase58(),
      tandemMint: config.tandemMint.toBase58(),
      stakerRewardAta: config.stakerRewardAta.toBase58(),
      treasuryAta: config.treasuryAta.toBase58(),
      totalStaked: config.totalStaked.toString(),
    }, null, 2));
    return;
  }

  const tandemMint = await createMint(
    connection,
    authorityKeypair,
    authorityKeypair.publicKey,
    null,
    6
  );
  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authorityKeypair,
    usdcMint,
    treasuryOwner
  );
  const stakerRewardAta = getAssociatedTokenAddressSync(usdcMint, protocolConfig, true);
  const stakeTandemAta = getAssociatedTokenAddressSync(tandemMint, protocolConfig, true);

  const signature = await program.methods
    .initializeProtocol(feeBps)
    .accounts({
      authority: authorityKeypair.publicKey,
      protocolConfig,
      usdcMint,
      tandemMint,
      stakerRewardAta,
      treasuryAta: treasuryAta.address,
      stakeTandemAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  const state = {
    status: "initialized",
    signature,
    programId: programId.toBase58(),
    authority: authorityKeypair.publicKey.toBase58(),
    protocolConfig: protocolConfig.toBase58(),
    feeBps,
    usdcMint: usdcMint.toBase58(),
    tandemMint: tandemMint.toBase58(),
    stakerRewardAta: stakerRewardAta.toBase58(),
    stakeTandemAta: stakeTandemAta.toBase58(),
    treasuryWallet: treasuryOwner.toBase58(),
    treasuryAta: treasuryAta.address.toBase58(),
  };

  fs.writeFileSync(
    path.join(repoRoot, "devnet-protocol.json"),
    `${JSON.stringify(state, null, 2)}\n`
  );
  console.log(JSON.stringify(state, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
