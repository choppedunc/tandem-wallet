const anchor = require("@coral-xyz/anchor");
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

function readKeypair(filePath) {
  const expanded = filePath.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf8"))));
}

function expandPath(filePath) {
  return path.resolve(filePath.replace(/^~(?=$|\/)/, os.homedir()));
}

function isInsideRepo(filePath) {
  const relative = path.relative(repoRoot, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function protocolOutputPath(isMainnetDeploy) {
  if (process.env.PROTOCOL_OUTPUT_PATH) {
    const outputPath = expandPath(process.env.PROTOCOL_OUTPUT_PATH);
    if (isMainnetDeploy && isInsideRepo(outputPath)) {
      throw new Error("PROTOCOL_OUTPUT_PATH must be outside this repo for mainnet initialization");
    }
    return outputPath;
  }

  return isMainnetDeploy ? null : path.join(repoRoot, "devnet-protocol.json");
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
  const isMainnetDeploy =
    process.env.MAINNET_DEPLOY === "true" || /mainnet/i.test(rpcUrl);
  const authorityKeypair = readKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");
  if (isMainnetDeploy && !process.env.TREASURY_OWNER && !process.env.TREASURY_WALLET) {
    throw new Error("TREASURY_OWNER or TREASURY_WALLET is required for mainnet initialization");
  }
  if (isMainnetDeploy && !process.env.TANDEM_MINT) {
    throw new Error("TANDEM_MINT is required for mainnet initialization");
  }
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
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
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

  let createdTandemMint = false;
  let tandemMint = process.env.TANDEM_MINT ? new PublicKey(process.env.TANDEM_MINT) : null;
  if (!tandemMint) {
    tandemMint = await createMint(
      connection,
      authorityKeypair,
      authorityKeypair.publicKey,
      null,
      6
    );
    createdTandemMint = true;
  }

  const tandemMintInfo = await connection.getAccountInfo(tandemMint);
  if (!tandemMintInfo) {
    throw new Error(`TANDEM_MINT account not found: ${tandemMint.toBase58()}`);
  }
  if (
    !tandemMintInfo.owner.equals(TOKEN_PROGRAM_ID) &&
    !tandemMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error(`TANDEM_MINT is not owned by a supported token program: ${tandemMintInfo.owner.toBase58()}`);
  }
  const tandemTokenProgram = tandemMintInfo.owner;

  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authorityKeypair,
    usdcMint,
    treasuryOwner
  );
  const stakerRewardAta = getAssociatedTokenAddressSync(usdcMint, protocolConfig, true);
  const stakeTandemAta = getAssociatedTokenAddressSync(
    tandemMint,
    protocolConfig,
    true,
    tandemTokenProgram
  );

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
      program: programId,
      programData,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      tandemTokenProgram,
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
    tandemTokenProgram: tandemTokenProgram.toBase58(),
    tandemMintCreated: createdTandemMint,
    stakerRewardAta: stakerRewardAta.toBase58(),
    stakeTandemAta: stakeTandemAta.toBase58(),
    treasuryWallet: treasuryOwner.toBase58(),
    treasuryAta: treasuryAta.address.toBase58(),
  };

  const outputPath = protocolOutputPath(isMainnetDeploy);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`);
  }
  console.log(JSON.stringify(state, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
