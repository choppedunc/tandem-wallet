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
  const newAuthorityArg = process.argv[2] ?? process.env.NEW_PROTOCOL_AUTHORITY;
  if (!newAuthorityArg) {
    throw new Error("Usage: transfer-protocol-authority.cjs <new_authority_wallet>");
  }

  const newAuthority = new PublicKey(newAuthorityArg);
  if (newAuthority.equals(PublicKey.default)) {
    throw new Error("new_authority_wallet must not be the default public key");
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
  const previousAuthority = config.authority;

  if (!previousAuthority.equals(authorityKeypair.publicKey)) {
    throw new Error(
      `Signer is not protocol authority. Expected ${previousAuthority.toBase58()}, got ${authorityKeypair.publicKey.toBase58()}.`
    );
  }

  const signature = await program.methods
    .transferProtocolAuthority(newAuthority)
    .accounts({
      authority: authorityKeypair.publicKey,
      protocolConfig,
    })
    .rpc();

  console.log(JSON.stringify({
    signature,
    protocolConfig: protocolConfig.toBase58(),
    previousAuthority: previousAuthority.toBase58(),
    newAuthority: newAuthority.toBase58(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
