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

function usdcToRaw(amount) {
  return new anchor.BN(Math.round(Number(amount) * 1_000_000).toString());
}

async function main() {
  const vaultAddressArg = process.argv[2] ?? process.env.TANDEM_VAULT_ADDRESS;
  const limitArg = process.argv[3] ?? process.env.TANDEM_SPENDING_LIMIT_USDC;
  if (!vaultAddressArg || limitArg === undefined) {
    throw new Error("Usage: set-vault-limit.cjs <vault_address> <limit_usdc>");
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );
  const humanKeypair = readKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");
  const vaultAddress = new PublicKey(vaultAddressArg);
  const spendingLimit = usdcToRaw(limitArg);

  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(humanKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);
  const signature = await program.methods
    .setLimit(spendingLimit)
    .accounts({
      human: humanKeypair.publicKey,
      vault: vaultAddress,
    })
    .rpc();

  console.log(JSON.stringify({
    signature,
    vault: vaultAddress.toBase58(),
    spendingLimitRaw: spendingLimit.toString(),
    spendingLimitUsdc: Number(limitArg),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
