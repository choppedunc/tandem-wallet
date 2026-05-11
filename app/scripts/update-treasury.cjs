const anchor = require("@coral-xyz/anchor");
const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");
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
  const treasuryOwnerArg =
    process.argv[2] ?? process.env.TREASURY_OWNER ?? process.env.TREASURY_WALLET;
  const treasuryAtaArg = process.env.TREASURY_ATA;

  if (!treasuryOwnerArg && !treasuryAtaArg) {
    throw new Error("Usage: update-treasury.cjs <treasury_owner_wallet>");
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );
  const authorityKeypair = readKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");

  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );
  const config = await program.account.protocolConfig.fetch(protocolConfig);
  let treasuryAta;
  let treasuryOwner = null;

  if (treasuryAtaArg) {
    treasuryAta = new PublicKey(treasuryAtaArg);
  } else {
    treasuryOwner = new PublicKey(treasuryOwnerArg);
    const account = await getOrCreateAssociatedTokenAccount(
      connection,
      authorityKeypair,
      config.usdcMint,
      treasuryOwner
    );
    treasuryAta = account.address;
  }

  const signature = await program.methods
    .updateTreasury()
    .accounts({
      authority: authorityKeypair.publicKey,
      protocolConfig,
      treasuryAta,
    })
    .rpc();

  console.log(JSON.stringify({
    signature,
    protocolConfig: protocolConfig.toBase58(),
    previousTreasuryAta: config.treasuryAta.toBase58(),
    treasuryAta: treasuryAta.toBase58(),
    treasuryOwner: treasuryOwner ? treasuryOwner.toBase58() : null,
    feeBps: config.feeBps,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
