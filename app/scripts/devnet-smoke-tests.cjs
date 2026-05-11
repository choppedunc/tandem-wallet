const anchor = require("@coral-xyz/anchor");
const {
  TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} = require("@solana/spl-token");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const idl = require("../src/lib/idl.json");

const TEST_LIMIT_RAW = 50_000n; // 0.05 USDC
const ALLOWANCE_AMOUNT_RAW = 10_000n; // 0.01 USDC
const APPROVED_AMOUNT_RAW = 80_000n; // 0.08 USDC
const REJECTED_AMOUNT_RAW = 90_000n; // 0.09 USDC
const WHITELIST_AMOUNT_RAW = 70_000n; // 0.07 USDC
const PAUSED_AMOUNT_RAW = 10_000n; // 0.01 USDC

function readKeypair(filePath) {
  const expanded = filePath.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf8"))));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readAgentKeypair(privateStatePath) {
  const state = readJson(privateStatePath);
  if (state.agentPrivateKeyBase58) {
    return Keypair.fromSecretKey(bs58.decode(state.agentPrivateKeyBase58));
  }
  throw new Error(`Missing agentPrivateKeyBase58 in ${privateStatePath}`);
}

function bn(value) {
  return new anchor.BN(value.toString());
}

function formatUsdc(raw) {
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction} USDC`;
}

function feeFor(amount, feeBps) {
  return (amount * BigInt(feeBps)) / 10_000n;
}

async function tokenBalance(connection, address) {
  const account = await getAccount(connection, address);
  return BigInt(account.amount.toString());
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertBalanceDeltas(label, before, after, expected) {
  for (const [key, expectedDelta] of Object.entries(expected)) {
    const delta = after[key] - before[key];
    assertEqual(`${label} ${key} delta`, delta, expectedDelta);
  }
}

async function snapshotBalances(connection, accounts) {
  return {
    vault: await tokenBalance(connection, accounts.vaultUsdcAta),
    recipient: await tokenBalance(connection, accounts.recipientAta),
    treasury: await tokenBalance(connection, accounts.treasuryAta),
    stakerReward: await tokenBalance(connection, accounts.stakerRewardAta),
  };
}

function expectedFeeSplit(amount, feeBps, totalStaked) {
  const fee = feeFor(amount, feeBps);
  if (totalStaked > 0n) {
    const staker = fee / 2n;
    return { fee, staker, treasury: fee - staker };
  }
  return { fee, staker: 0n, treasury: fee };
}

async function ensureAgentSol(connection, humanKeypair, agentPublicKey) {
  const minimum = 50_000_000;
  const balance = await connection.getBalance(agentPublicKey);
  if (balance >= minimum) return null;

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: humanKeypair.publicKey,
        toPubkey: agentPublicKey,
        lamports: 100_000_000,
      })
    ),
    [humanKeypair],
    { commitment: "confirmed" }
  );
  return signature;
}

async function setLimit(program, humanPublicKey, vault, amountRaw) {
  return program.methods
    .setLimit(bn(amountRaw))
    .accounts({ human: humanPublicKey, vault })
    .rpc();
}

async function pause(program, humanPublicKey, vault) {
  return program.methods.pause().accounts({ human: humanPublicKey, vault }).rpc();
}

async function unpause(program, humanPublicKey, vault) {
  return program.methods.unpause().accounts({ human: humanPublicKey, vault }).rpc();
}

async function sendUsdc({
  program,
  agentKeypair,
  vault,
  vaultUsdcAta,
  recipientAta,
  whitelistEntry,
  protocolConfig,
  config,
  amountRaw,
}) {
  return program.methods
    .sendUsdc(bn(amountRaw))
    .accounts({
      signer: agentKeypair.publicKey,
      vault,
      vaultUsdcAta,
      recipientAta,
      whitelistEntry,
      protocolConfig,
      stakerRewardAta: config.stakerRewardAta,
      treasuryAta: config.treasuryAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([agentKeypair])
    .rpc();
}

async function createProposal({
  program,
  programId,
  agentKeypair,
  vault,
  protocolConfig,
  recipient,
  recipientAta,
  amountRaw,
  memo,
}) {
  const vaultState = await program.account.vault.fetch(vault);
  const proposalId = vaultState.proposalCount;
  const [proposal] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), vault.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
    programId
  );
  const signature = await program.methods
    .propose(bn(amountRaw), memo)
    .accounts({
      agent: agentKeypair.publicKey,
      vault,
      recipient,
      protocolConfig,
      recipientAta,
      proposal,
      systemProgram: SystemProgram.programId,
    })
    .signers([agentKeypair])
    .rpc();

  return { proposal, proposalId: proposalId.toString(), signature };
}

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );
  const humanKeypair = readKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");
  const vaultStatePath = path.resolve(
    repoRoot,
    process.env.DEVNET_VAULT_PUBLIC_PATH || "devnet-vault.json"
  );
  const privateStatePath = path.resolve(
    repoRoot,
    process.env.DEVNET_VAULT_PRIVATE_PATH || "devnet-vault-private.json"
  );
  const vaultState = readJson(vaultStatePath);
  const agentKeypair = readAgentKeypair(privateStatePath);
  const vault = new PublicKey(vaultState.vault);
  const vaultUsdcAta = new PublicKey(vaultState.vaultUsdcAta);

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(humanKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );
  const config = await program.account.protocolConfig.fetch(protocolConfig);
  const vaultAccount = await program.account.vault.fetch(vault);
  const originalLimit = BigInt(vaultAccount.spendingLimit.toString());
  const originalPaused = Boolean(vaultAccount.paused);

  if (!vaultAccount.human.equals(humanKeypair.publicKey)) {
    throw new Error(`Vault human does not match local wallet: ${vaultAccount.human.toBase58()}`);
  }
  if (!vaultAccount.agent.equals(agentKeypair.publicKey)) {
    throw new Error(`Vault agent does not match private state: ${vaultAccount.agent.toBase58()}`);
  }
  if (!vaultAccount.usdcMint.equals(config.usdcMint)) {
    throw new Error(
      `Vault mint ${vaultAccount.usdcMint.toBase58()} does not match protocol USDC mint ${config.usdcMint.toBase58()}`
    );
  }

  const recipient = Keypair.generate();
  const recipientAtaAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    humanKeypair,
    config.usdcMint,
    recipient.publicKey
  );
  const recipientAta = recipientAtaAccount.address;
  const accounts = {
    vaultUsdcAta,
    recipientAta,
    treasuryAta: config.treasuryAta,
    stakerRewardAta: config.stakerRewardAta,
  };
  const totalStaked = BigInt(config.totalStaked.toString());
  const requiredSpend =
    ALLOWANCE_AMOUNT_RAW +
    APPROVED_AMOUNT_RAW +
    WHITELIST_AMOUNT_RAW +
    feeFor(ALLOWANCE_AMOUNT_RAW, config.feeBps) +
    feeFor(APPROVED_AMOUNT_RAW, config.feeBps) +
    feeFor(WHITELIST_AMOUNT_RAW, config.feeBps);
  const initialVaultBalance = await tokenBalance(connection, vaultUsdcAta);
  if (initialVaultBalance < requiredSpend) {
    throw new Error(
      `Vault has ${formatUsdc(initialVaultBalance)}, but smoke tests need at least ${formatUsdc(requiredSpend)}`
    );
  }

  const results = [];
  let whitelistEntry = null;
  let cleanupWhitelist = false;

  const agentTopUpSignature = await ensureAgentSol(
    connection,
    humanKeypair,
    agentKeypair.publicKey
  );
  if (agentTopUpSignature) {
    results.push({ test: "agent-sol-top-up", status: "ok", signature: agentTopUpSignature });
  }

  try {
    if (originalPaused) {
      await unpause(program, humanKeypair.publicKey, vault);
    }
    if (originalLimit !== TEST_LIMIT_RAW) {
      await setLimit(program, humanKeypair.publicKey, vault, TEST_LIMIT_RAW);
    }

    {
      const before = await snapshotBalances(connection, accounts);
      const signature = await sendUsdc({
        program,
        agentKeypair,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        protocolConfig,
        config,
        amountRaw: ALLOWANCE_AMOUNT_RAW,
      });
      const after = await snapshotBalances(connection, accounts);
      const split = expectedFeeSplit(ALLOWANCE_AMOUNT_RAW, config.feeBps, totalStaked);
      assertBalanceDeltas("allowance", before, after, {
        vault: -(ALLOWANCE_AMOUNT_RAW + split.fee),
        recipient: ALLOWANCE_AMOUNT_RAW,
        treasury: split.treasury,
        stakerReward: split.staker,
      });
      results.push({
        test: "allowance transaction",
        status: "ok",
        signature,
        amount: formatUsdc(ALLOWANCE_AMOUNT_RAW),
        fee: formatUsdc(split.fee),
      });
    }

    {
      const before = await snapshotBalances(connection, accounts);
      const created = await createProposal({
        program,
        programId,
        agentKeypair,
        vault,
        protocolConfig,
        recipient: recipient.publicKey,
        recipientAta,
        amountRaw: APPROVED_AMOUNT_RAW,
        memo: "Smoke test: approve",
      });
      const signature = await program.methods
        .approveProposal()
        .accounts({
          human: humanKeypair.publicKey,
          vault,
          proposal: created.proposal,
          vaultUsdcAta,
          recipientAta,
          protocolConfig,
          stakerRewardAta: config.stakerRewardAta,
          treasuryAta: config.treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      const proposal = await program.account.proposal.fetch(created.proposal);
      assertEqual("approved proposal executed", Boolean(proposal.executed), true);
      const after = await snapshotBalances(connection, accounts);
      const split = expectedFeeSplit(APPROVED_AMOUNT_RAW, config.feeBps, totalStaked);
      assertBalanceDeltas("approved proposal", before, after, {
        vault: -(APPROVED_AMOUNT_RAW + split.fee),
        recipient: APPROVED_AMOUNT_RAW,
        treasury: split.treasury,
        stakerReward: split.staker,
      });
      results.push({
        test: "human approved transaction",
        status: "ok",
        proposalId: created.proposalId,
        proposalSignature: created.signature,
        signature,
        amount: formatUsdc(APPROVED_AMOUNT_RAW),
        fee: formatUsdc(split.fee),
      });
    }

    {
      const before = await snapshotBalances(connection, accounts);
      const created = await createProposal({
        program,
        programId,
        agentKeypair,
        vault,
        protocolConfig,
        recipient: recipient.publicKey,
        recipientAta,
        amountRaw: REJECTED_AMOUNT_RAW,
        memo: "Smoke test: reject",
      });
      const signature = await program.methods
        .cancelProposal()
        .accounts({
          human: humanKeypair.publicKey,
          vault,
          proposal: created.proposal,
        })
        .rpc();
      const proposal = await program.account.proposal.fetch(created.proposal);
      assertEqual("rejected proposal cancelled", Boolean(proposal.cancelled), true);
      const after = await snapshotBalances(connection, accounts);
      assertBalanceDeltas("rejected proposal", before, after, {
        vault: 0n,
        recipient: 0n,
        treasury: 0n,
        stakerReward: 0n,
      });
      results.push({
        test: "human rejected transaction",
        status: "ok",
        proposalId: created.proposalId,
        proposalSignature: created.signature,
        signature,
        amount: formatUsdc(REJECTED_AMOUNT_RAW),
      });
    }

    {
      [whitelistEntry] = PublicKey.findProgramAddressSync(
        [Buffer.from("whitelist"), vault.toBuffer(), recipient.publicKey.toBuffer()],
        programId
      );
      const addSignature = await program.methods
        .addWhitelist(recipient.publicKey)
        .accounts({
          human: humanKeypair.publicKey,
          vault,
          whitelistEntry,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      cleanupWhitelist = true;

      const before = await snapshotBalances(connection, accounts);
      const signature = await sendUsdc({
        program,
        agentKeypair,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry,
        protocolConfig,
        config,
        amountRaw: WHITELIST_AMOUNT_RAW,
      });
      const after = await snapshotBalances(connection, accounts);
      const split = expectedFeeSplit(WHITELIST_AMOUNT_RAW, config.feeBps, totalStaked);
      assertBalanceDeltas("whitelist", before, after, {
        vault: -(WHITELIST_AMOUNT_RAW + split.fee),
        recipient: WHITELIST_AMOUNT_RAW,
        treasury: split.treasury,
        stakerReward: split.staker,
      });
      results.push({
        test: "whitelist transaction",
        status: "ok",
        addWhitelistSignature: addSignature,
        signature,
        amount: formatUsdc(WHITELIST_AMOUNT_RAW),
        fee: formatUsdc(split.fee),
      });
    }

    {
      const pauseSignature = await pause(program, humanKeypair.publicKey, vault);
      const before = await snapshotBalances(connection, accounts);
      let failedAsExpected = false;
      let errorMessage = "";
      try {
        await sendUsdc({
          program,
          agentKeypair,
          vault,
          vaultUsdcAta,
          recipientAta,
          whitelistEntry: null,
          protocolConfig,
          config,
          amountRaw: PAUSED_AMOUNT_RAW,
        });
      } catch (error) {
        failedAsExpected = true;
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      if (!failedAsExpected) {
        throw new Error("Paused vault agent send unexpectedly succeeded");
      }
      const after = await snapshotBalances(connection, accounts);
      assertBalanceDeltas("paused vault rejection", before, after, {
        vault: 0n,
        recipient: 0n,
        treasury: 0n,
        stakerReward: 0n,
      });
      results.push({
        test: "paused vault transaction",
        status: "ok",
        pauseSignature,
        expectedFailure: "agent send rejected while vault paused",
        error: errorMessage.split("\n")[0],
      });
    }
  } finally {
    const latestVault = await program.account.vault.fetch(vault);
    if (latestVault.paused) {
      await unpause(program, humanKeypair.publicKey, vault);
    }
    if (cleanupWhitelist && whitelistEntry) {
      try {
        await program.methods
          .removeWhitelist()
          .accounts({ human: humanKeypair.publicKey, vault, whitelistEntry })
          .rpc();
      } catch {
        // Best-effort cleanup; a failed test should surface the original issue.
      }
    }
    if (originalLimit !== TEST_LIMIT_RAW) {
      await setLimit(program, humanKeypair.publicKey, vault, originalLimit);
    }
    if (originalPaused) {
      await pause(program, humanKeypair.publicKey, vault);
    }
  }

  const finalVault = await program.account.vault.fetch(vault);
  console.log(
    JSON.stringify(
      {
        status: "ok",
        vault: vault.toBase58(),
        recipient: recipient.publicKey.toBase58(),
        protocolConfig: protocolConfig.toBase58(),
        treasuryAta: config.treasuryAta.toBase58(),
        feeBps: config.feeBps,
        totalStaked: totalStaked.toString(),
        restoredSpendingLimitRaw: finalVault.spendingLimit.toString(),
        restoredPaused: finalVault.paused,
        results,
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
