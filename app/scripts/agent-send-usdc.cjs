const anchor = require("@coral-xyz/anchor");
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");

const idl = require("../src/lib/idl.json");

const USDC_DECIMALS = 6n;
const USDC_SCALE = 10n ** USDC_DECIMALS;

function readAgentKeypair() {
  const value =
    process.env.TANDEM_AGENT_PRIVATE_KEY_BASE58 ||
    process.env.AGENT_PRIVATE_KEY_BASE58 ||
    process.env.AGENT_PRIVATE_KEY;
  if (!value) {
    throw new Error(
      "Set TANDEM_AGENT_PRIVATE_KEY_BASE58 to the agent private key."
    );
  }
  return Keypair.fromSecretKey(bs58.decode(value));
}

function parseUsdc(value) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error("Amount must be a positive USDC value with up to 6 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const raw =
    BigInt(whole) * USDC_SCALE +
    BigInt(fraction.padEnd(Number(USDC_DECIMALS), "0"));
  if (raw <= 0n) throw new Error("Amount must be greater than zero.");
  return raw;
}

async function tokenBalance(connection, address) {
  try {
    const balance = await connection.getTokenAccountBalance(address);
    return {
      raw: balance.value.amount,
      uiAmountString: balance.value.uiAmountString,
    };
  } catch {
    return {
      raw: "0",
      uiAmountString: "0",
    };
  }
}

async function main() {
  const vaultAddressArg = process.argv[2] ?? process.env.TANDEM_VAULT_ADDRESS;
  const recipientArg = process.argv[3] ?? process.env.TANDEM_RECIPIENT;
  const amountArg = process.argv[4] ?? process.env.TANDEM_AMOUNT_USDC ?? "0.1";

  if (!vaultAddressArg || !recipientArg) {
    throw new Error(
      "Usage: agent-send-usdc.cjs <vault_address> <recipient_wallet> [amount_usdc]"
    );
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );
  const agentKeypair = readAgentKeypair();
  const vaultAddress = new PublicKey(vaultAddressArg);
  const recipient = new PublicKey(recipientArg);
  const amountRaw = parseUsdc(amountArg);

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(agentKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);
  const vaultBefore = await program.account.vault.fetch(vaultAddress);

  if (!vaultBefore.agent.equals(agentKeypair.publicKey)) {
    throw new Error(
      `Agent key mismatch. Vault expects ${vaultBefore.agent.toBase58()}, got ${agentKeypair.publicKey.toBase58()}.`
    );
  }

  if (amountRaw > BigInt(vaultBefore.spendingLimit.toString())) {
    throw new Error(
      `Amount ${amountArg} USDC exceeds vault spending limit ${Number(
        vaultBefore.spendingLimit.toString()
      ) / 1_000_000} USDC.`
    );
  }

  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );
  const config = await program.account.protocolConfig.fetch(protocolConfig);
  const recipientAta = getAssociatedTokenAddressSync(vaultBefore.usdcMint, recipient);
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    throw new Error(
      `Recipient USDC token account does not exist: ${recipientAta.toBase58()}`
    );
  }

  const [vaultBalanceBefore, recipientBalanceBefore] = await Promise.all([
    tokenBalance(connection, vaultBefore.vaultUsdcAta),
    tokenBalance(connection, recipientAta),
  ]);

  const signature = await program.methods
    .sendUsdc(new anchor.BN(amountRaw.toString()))
    .accounts({
      signer: agentKeypair.publicKey,
      vault: vaultAddress,
      vaultUsdcAta: vaultBefore.vaultUsdcAta,
      recipientAta,
      whitelistEntry: null,
      protocolConfig,
      stakerRewardAta: config.stakerRewardAta,
      buybackAta: config.buybackAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  const vaultAfter = await program.account.vault.fetch(vaultAddress);
  const [vaultBalanceAfter, recipientBalanceAfter] = await Promise.all([
    tokenBalance(connection, vaultAfter.vaultUsdcAta),
    tokenBalance(connection, recipientAta),
  ]);

  console.log(
    JSON.stringify(
      {
        signature,
        vault: vaultAddress.toBase58(),
        agent: agentKeypair.publicKey.toBase58(),
        recipient: recipient.toBase58(),
        recipientAta: recipientAta.toBase58(),
        amountUsdc: amountArg,
        amountRaw: amountRaw.toString(),
        spendingLimitRaw: vaultBefore.spendingLimit.toString(),
        spendingLimitUsdc: Number(vaultBefore.spendingLimit.toString()) / 1_000_000,
        proposalCountBefore: vaultBefore.proposalCount.toString(),
        proposalCountAfter: vaultAfter.proposalCount.toString(),
        vaultBalanceBefore,
        vaultBalanceAfter,
        recipientBalanceBefore,
        recipientBalanceAfter,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
