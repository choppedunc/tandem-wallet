const anchor = require("@coral-xyz/anchor");
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");
const {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const idl = require("../src/lib/idl.json");

function readKeypair(filePath) {
  const expanded = filePath.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf8"))));
}

function readOrCreateKeypair(filePath) {
  if (fs.existsSync(filePath)) {
    return readKeypair(filePath);
  }

  const keypair = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
  fs.chmodSync(filePath, 0o600);
  return keypair;
}

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );
  const usdcMint = new PublicKey(
    process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  );
  const spendingLimitRaw = new anchor.BN(process.env.SPENDING_LIMIT_RAW || "50000000");
  const humanKeypair = readKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");
  const agentKeypairPath = path.resolve(
    repoRoot,
    process.env.DEVNET_AGENT_KEYPAIR_PATH || "devnet-agent-keypair.json"
  );
  const publicStatePath = path.resolve(
    repoRoot,
    process.env.DEVNET_VAULT_PUBLIC_PATH || "devnet-vault.json"
  );
  const privateStatePath = path.resolve(
    repoRoot,
    process.env.DEVNET_VAULT_PRIVATE_PATH || "devnet-vault-private.json"
  );
  const agentKeypair = readOrCreateKeypair(agentKeypairPath);

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(humanKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), humanKeypair.publicKey.toBuffer(), agentKeypair.publicKey.toBuffer()],
    programId
  );
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );
  const vaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, vault, true);

  const existing = await connection.getAccountInfo(vault);
  let signature = null;
  if (!existing) {
    signature = await program.methods
      .initialize(spendingLimitRaw)
      .accounts({
        human: humanKeypair.publicKey,
        agent: agentKeypair.publicKey,
        usdcMint,
        protocolConfig,
        vault,
        vaultUsdcAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  }

  const publicState = {
    status: existing ? "exists" : "initialized",
    signature,
    programId: programId.toBase58(),
    human: humanKeypair.publicKey.toBase58(),
    agent: agentKeypair.publicKey.toBase58(),
    vault: vault.toBase58(),
    vaultUsdcAta: vaultUsdcAta.toBase58(),
    usdcMint: usdcMint.toBase58(),
    spendingLimitRaw: spendingLimitRaw.toString(),
    spendingLimitUsdc: Number(spendingLimitRaw.toString()) / 1_000_000,
  };
  const privateState = {
    ...publicState,
    agentPrivateKeyBase58: bs58.encode(agentKeypair.secretKey),
  };

  fs.writeFileSync(publicStatePath, `${JSON.stringify(publicState, null, 2)}\n`);
  fs.writeFileSync(privateStatePath, `${JSON.stringify(privateState, null, 2)}\n`);
  fs.chmodSync(privateStatePath, 0o600);

  console.log(JSON.stringify(publicState, null, 2));
  console.log(`Private agent state written to ${path.relative(repoRoot, privateStatePath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
