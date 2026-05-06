const anchor = require("@coral-xyz/anchor");
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
  const feeBpsArg = process.argv[2] ?? process.env.PROTOCOL_FEE_BPS;
  if (feeBpsArg === undefined) {
    throw new Error("Usage: update-protocol-fee.cjs <fee_bps>");
  }

  const feeBps = Number(feeBpsArg);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error("fee_bps must be an integer between 0 and 10000");
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

  const signature = await program.methods
    .updateProtocolConfig(feeBps)
    .accounts({
      authority: authorityKeypair.publicKey,
      protocolConfig,
      buybackAta: config.buybackAta,
    })
    .rpc();

  console.log(JSON.stringify({
    signature,
    protocolConfig: protocolConfig.toBase58(),
    previousFeeBps: config.feeBps,
    feeBps,
    buybackAta: config.buybackAta.toBase58(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
