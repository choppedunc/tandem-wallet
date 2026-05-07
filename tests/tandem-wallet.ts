import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  mintTo,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Load IDL directly since generated types may not match
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/tandem_wallet.json"), "utf-8"));

describe("tandem-wallet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl, provider) as any;

  // Test accounts
  let usdcMint: PublicKey;
  let tandemMint: PublicKey;
  let mintAuthority: Keypair;
  let human: PublicKey;
  let agent: Keypair;
  let recipient: Keypair;
  let vault: PublicKey;
  let vaultBump: number;
  let vaultUsdcAta: PublicKey;
  let recipientAta: PublicKey;

  // Protocol accounts
  let protocolConfig: PublicKey;
  let stakerRewardAta: PublicKey;
  let treasuryWallet: Keypair;
  let treasuryAta: PublicKey;
  let stakeTandemAta: PublicKey;

  const SPENDING_LIMIT = new BN(50_000_000); // 50 USDC
  const INITIAL_VAULT_BALANCE = 1_000_000_000; // 1000 USDC
  const FEE_BPS = 25; // 0.25%

  before("Setup test environment", async () => {
    mintAuthority = Keypair.generate();
    agent = Keypair.generate();
    recipient = Keypair.generate();
    treasuryWallet = Keypair.generate();
    human = provider.wallet.publicKey;

    // Airdrop SOL
    const sig1 = await provider.connection.requestAirdrop(mintAuthority.publicKey, 10e9);
    const sig2 = await provider.connection.requestAirdrop(agent.publicKey, 10e9);
    const sig3 = await provider.connection.requestAirdrop(recipient.publicKey, 10e9);
    const sig4 = await provider.connection.requestAirdrop(treasuryWallet.publicKey, 10e9);
    await provider.connection.confirmTransaction(sig1);
    await provider.connection.confirmTransaction(sig2);
    await provider.connection.confirmTransaction(sig3);
    await provider.connection.confirmTransaction(sig4);

    // Create USDC mock mint (6 decimals)
    usdcMint = await createMint(provider.connection, mintAuthority, mintAuthority.publicKey, null, 6);

    // Create TANDEM mock mint (6 decimals)
    tandemMint = await createMint(provider.connection, mintAuthority, mintAuthority.publicKey, null, 6);

    // Derive vault PDA
    [vault, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), human.toBuffer(), agent.publicKey.toBuffer()],
      program.programId
    );

    // Derive vault USDC ATA
    vaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, vault, true);

    // Create recipient ATA
    const recipientAtaAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection, mintAuthority, usdcMint, recipient.publicKey
    );
    recipientAta = recipientAtaAccount.address;

    // Derive protocol config PDA
    [protocolConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId
    );

    // Derive protocol ATAs
    stakerRewardAta = getAssociatedTokenAddressSync(usdcMint, protocolConfig, true);
    stakeTandemAta = getAssociatedTokenAddressSync(tandemMint, protocolConfig, true);

    // Create treasury wallet's USDC ATA
    const treasuryAtaAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection, mintAuthority, usdcMint, treasuryWallet.publicKey
    );
    treasuryAta = treasuryAtaAccount.address;
  });

  // Helper: common fee accounts for send_usdc
  function feeAccounts() {
    return {
      protocolConfig,
      stakerRewardAta,
      treasuryAta,
    };
  }

  it("Initializes the vault", async () => {
    await program.methods
      .initialize(SPENDING_LIMIT)
      .accounts({
        human,
        agent: agent.publicKey,
        usdcMint,
        vault,
        vaultUsdcAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const vaultAccount = await program.account.vault.fetch(vault);
    expect(vaultAccount.human.toString()).to.equal(human.toString());
    expect(vaultAccount.agent.toString()).to.equal(agent.publicKey.toString());
    expect(vaultAccount.spendingLimit.toString()).to.equal(SPENDING_LIMIT.toString());
    expect(vaultAccount.paused).to.be.false;
    expect(vaultAccount.proposalCount.toNumber()).to.equal(0);
  });

  it("Initializes the protocol config", async () => {
    await program.methods
      .initializeProtocol(FEE_BPS)
      .accounts({
        authority: human,
        protocolConfig,
        usdcMint,
        tandemMint,
        stakerRewardAta,
        treasuryAta,
        stakeTandemAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const config = await program.account.protocolConfig.fetch(protocolConfig);
    expect(config.authority.toString()).to.equal(human.toString());
    expect(config.feeBps).to.equal(FEE_BPS);
    expect(config.usdcMint.toString()).to.equal(usdcMint.toString());
    expect(config.tandemMint.toString()).to.equal(tandemMint.toString());
    expect(config.stakerRewardAta.toString()).to.equal(stakerRewardAta.toString());
    expect(config.treasuryAta.toString()).to.equal(treasuryAta.toString());
    expect(config.totalStaked.toNumber()).to.equal(0);
  });

  it("Funds the vault with USDC", async () => {
    await mintTo(provider.connection, mintAuthority, usdcMint, vaultUsdcAta, mintAuthority, INITIAL_VAULT_BALANCE);

    const balance = await getAccount(provider.connection, vaultUsdcAta);
    expect(Number(balance.amount)).to.equal(INITIAL_VAULT_BALANCE);
  });

  // --- Tier routing tests (now with fee accounts) ---

  it("Agent sends Tier 1 amount (30 USDC) with 0.25% fee redirected to treasury when no one is staked", async () => {
    const amount = new BN(30_000_000);
    const beforeRecipient = await getAccount(provider.connection, recipientAta);
    const beforeStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const beforeTreasury = await getAccount(provider.connection, treasuryAta);

    await program.methods
      .sendUsdc(amount)
      .accounts({
        signer: agent.publicKey,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const afterRecipient = await getAccount(provider.connection, recipientAta);
    const afterStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const afterTreasury = await getAccount(provider.connection, treasuryAta);

    // Recipient gets exact amount
    expect(Number(afterRecipient.amount) - Number(beforeRecipient.amount)).to.equal(30_000_000);

    // Fee = 30_000_000 * 25 / 10000 = 75_000
    // No one is staked yet, so the staker portion redirects to treasury.
    const stakerFee = Number(afterStakerReward.amount) - Number(beforeStakerReward.amount);
    const treasuryFee = Number(afterTreasury.amount) - Number(beforeTreasury.amount);
    expect(stakerFee).to.equal(0);
    expect(treasuryFee).to.equal(75_000);
  });

  it("Send at exactly the limit succeeds (50 USDC)", async () => {
    const before = await getAccount(provider.connection, recipientAta);

    await program.methods
      .sendUsdc(new BN(50_000_000))
      .accounts({
        signer: agent.publicKey,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const after = await getAccount(provider.connection, recipientAta);
    expect(Number(after.amount) - Number(before.amount)).to.equal(50_000_000);
  });

  it("Over spending limit fails (OverSpendingLimit)", async () => {
    try {
      await program.methods
        .sendUsdc(new BN(75_000_000))
        .accounts({
          signer: agent.publicKey,
          vault,
          vaultUsdcAta,
          recipientAta,
          whitelistEntry: null,
          ...feeAccounts(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("OverSpendingLimit");
    }
  });

  // --- Proposal tests ---

  let proposal1Pda: PublicKey;

  it("Rejects a proposal whose recipient token account does not match the displayed recipient", async () => {
    const proposalId = new BN(0);
    const [badProposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), vault.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    try {
      await program.methods
        .propose(new BN(150_000_000), "Mismatched recipient token account")
        .accounts({
          agent: agent.publicKey,
          vault,
          recipient: recipient.publicKey,
          recipientAta: treasuryAta,
          proposal: badProposalPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("InvalidRecipientAta");
    }
  });

  it("Agent proposes 150 USDC", async () => {
    const proposalId = new BN(0);
    [proposal1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), vault.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .propose(new BN(150_000_000), "Large payment")
      .accounts({
        agent: agent.publicKey,
        vault,
        recipient: recipient.publicKey,
        recipientAta,
        proposal: proposal1Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([agent])
      .rpc();

    const proposal = await program.account.proposal.fetch(proposal1Pda);
    expect(proposal.amount.toNumber()).to.equal(150_000_000);
    expect(proposal.executed).to.be.false;
    expect(proposal.cancelled).to.be.false;
    expect(proposal.memo).to.equal("Large payment");

    const vaultAccount = await program.account.vault.fetch(vault);
    expect(vaultAccount.proposalCount.toNumber()).to.equal(1);
  });

  it("Human approves proposal (funds transferred + fee)", async () => {
    const beforeRecipient = await getAccount(provider.connection, recipientAta);
    const beforeStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const beforeTreasury = await getAccount(provider.connection, treasuryAta);

    await program.methods
      .approveProposal()
      .accounts({
        human,
        vault,
        proposal: proposal1Pda,
        vaultUsdcAta,
        recipientAta,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const afterRecipient = await getAccount(provider.connection, recipientAta);
    expect(Number(afterRecipient.amount) - Number(beforeRecipient.amount)).to.equal(150_000_000);

    // Fee = 150_000_000 * 25 / 10000 = 375_000.
    // No one is staked yet, so the staker portion redirects to treasury.
    const afterStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const afterTreasury = await getAccount(provider.connection, treasuryAta);
    const stakerFee = Number(afterStakerReward.amount) - Number(beforeStakerReward.amount);
    const treasuryFee = Number(afterTreasury.amount) - Number(beforeTreasury.amount);
    expect(stakerFee).to.equal(0);
    expect(treasuryFee).to.equal(375_000);

    const proposal = await program.account.proposal.fetch(proposal1Pda);
    expect(proposal.executed).to.be.true;
  });

  let proposal2Pda: PublicKey;

  it("Human cancels a proposal", async () => {
    const proposalId = new BN(1);
    [proposal2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), vault.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .propose(new BN(200_000_000), "Will be cancelled")
      .accounts({
        agent: agent.publicKey,
        vault,
        recipient: recipient.publicKey,
        recipientAta,
        proposal: proposal2Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([agent])
      .rpc();

    await program.methods
      .cancelProposal()
      .accounts({ human, vault, proposal: proposal2Pda })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposal2Pda);
    expect(proposal.cancelled).to.be.true;
  });

  it("Agent closes executed proposal (rent reclaimed)", async () => {
    await program.methods
      .closeProposal()
      .accounts({ agent: agent.publicKey, vault, proposal: proposal1Pda })
      .signers([agent])
      .rpc();

    try {
      await program.account.proposal.fetch(proposal1Pda);
      expect.fail("Should be closed");
    } catch (e: any) {
      expect(e.message).to.include("Account does not exist");
    }
  });

  // --- Whitelist tests ---

  let whitelistPda: PublicKey;

  it("Human adds recipient to whitelist", async () => {
    [whitelistPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist"), vault.toBuffer(), recipient.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .addWhitelist(recipient.publicKey)
      .accounts({
        human,
        vault,
        whitelistEntry: whitelistPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const wl = await program.account.whitelistEntry.fetch(whitelistPda);
    expect(wl.address.toString()).to.equal(recipient.publicKey.toString());
  });

  it("Agent sends over the limit to whitelisted recipient (200 USDC)", async () => {
    const before = await getAccount(provider.connection, recipientAta);

    await program.methods
      .sendUsdc(new BN(200_000_000))
      .accounts({
        signer: agent.publicKey,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: whitelistPda,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const after = await getAccount(provider.connection, recipientAta);
    expect(Number(after.amount) - Number(before.amount)).to.equal(200_000_000);
  });

  it("Human removes recipient from whitelist", async () => {
    await program.methods
      .removeWhitelist()
      .accounts({ human, vault, whitelistEntry: whitelistPda })
      .rpc();

    try {
      await program.account.whitelistEntry.fetch(whitelistPda);
      expect.fail("Should be closed");
    } catch (e: any) {
      expect(e.message).to.include("Account does not exist");
    }
  });

  it("Agent over-limit send fails after whitelist removal", async () => {
    try {
      await program.methods
        .sendUsdc(new BN(75_000_000))
        .accounts({
          signer: agent.publicKey,
          vault,
          vaultUsdcAta,
          recipientAta,
          whitelistEntry: null,
          ...feeAccounts(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("OverSpendingLimit");
    }
  });

  // --- Admin tests ---

  it("Human updates spending limit", async () => {
    const newLimit = new BN(150_000_000);

    await program.methods
      .setLimit(newLimit)
      .accounts({ human, vault })
      .rpc();

    const v = await program.account.vault.fetch(vault);
    expect(v.spendingLimit.toString()).to.equal(newLimit.toString());
  });

  it("Human can set limit to 0 (every send needs approval)", async () => {
    await program.methods.setLimit(new BN(0)).accounts({ human, vault }).rpc();
    const v = await program.account.vault.fetch(vault);
    expect(v.spendingLimit.toNumber()).to.equal(0);

    // Even a 1-lamport agent send should now fail
    try {
      await program.methods
        .sendUsdc(new BN(1))
        .accounts({
          signer: agent.publicKey,
          vault,
          vaultUsdcAta,
          recipientAta,
          whitelistEntry: null,
          ...feeAccounts(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("OverSpendingLimit");
    }

    // Reset to 150 USDC for downstream tests
    await program.methods.setLimit(new BN(150_000_000)).accounts({ human, vault }).rpc();
  });

  it("Human pauses vault", async () => {
    await program.methods.pause().accounts({ human, vault }).rpc();
    const v = await program.account.vault.fetch(vault);
    expect(v.paused).to.be.true;
  });

  it("Agent send fails when paused", async () => {
    try {
      await program.methods
        .sendUsdc(new BN(10_000_000))
        .accounts({
          signer: agent.publicKey,
          vault,
          vaultUsdcAta,
          recipientAta,
          whitelistEntry: null,
          ...feeAccounts(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("VaultPaused");
    }
  });

  it("Human can still send when paused", async () => {
    const before = await getAccount(provider.connection, recipientAta);

    await program.methods
      .sendUsdc(new BN(10_000_000))
      .accounts({
        signer: human,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const after = await getAccount(provider.connection, recipientAta);
    expect(Number(after.amount) - Number(before.amount)).to.equal(10_000_000);
  });

  it("Human unpauses vault", async () => {
    await program.methods.unpause().accounts({ human, vault }).rpc();
    const v = await program.account.vault.fetch(vault);
    expect(v.paused).to.be.false;
  });

  it("Agent send succeeds after unpause", async () => {
    const before = await getAccount(provider.connection, recipientAta);

    await program.methods
      .sendUsdc(new BN(10_000_000))
      .accounts({
        signer: agent.publicKey,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const after = await getAccount(provider.connection, recipientAta);
    expect(Number(after.amount) - Number(before.amount)).to.equal(10_000_000);
  });

  // --- Fee precision tests ---

  it("Tiny amount: fee rounds to 0, no fee transfers", async () => {
    // 100 lamports = 0.0001 USDC. fee = 100 * 25 / 10000 = 0
    const amount = new BN(100);
    const beforeStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const beforeTreasury = await getAccount(provider.connection, treasuryAta);

    await program.methods
      .sendUsdc(amount)
      .accounts({
        signer: agent.publicKey,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const afterStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const afterTreasury = await getAccount(provider.connection, treasuryAta);

    expect(Number(afterStakerReward.amount) - Number(beforeStakerReward.amount)).to.equal(0);
    expect(Number(afterTreasury.amount) - Number(beforeTreasury.amount)).to.equal(0);
  });

  it("100 USDC send: 0.25 USDC fee redirects fully to treasury when no one is staked", async () => {
    const amount = new BN(100_000_000); // 100 USDC
    const beforeStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const beforeTreasury = await getAccount(provider.connection, treasuryAta);

    await program.methods
      .sendUsdc(amount)
      .accounts({
        signer: agent.publicKey,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const afterStakerReward = await getAccount(provider.connection, stakerRewardAta);
    const afterTreasury = await getAccount(provider.connection, treasuryAta);

    // Fee = 100_000_000 * 25 / 10000 = 250_000
    expect(Number(afterStakerReward.amount) - Number(beforeStakerReward.amount)).to.equal(0);
    expect(Number(afterTreasury.amount) - Number(beforeTreasury.amount)).to.equal(250_000);
  });

  // --- Staking tests ---

  let staker: Keypair;
  let stakerTandemAta: PublicKey;
  let stakerUsdcAta: PublicKey;
  let stakeAccountPda: PublicKey;

  it("Setup staker with TANDEM tokens", async () => {
    staker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(staker.publicKey, 10e9);
    await provider.connection.confirmTransaction(sig);

    // Create staker's TANDEM ATA and mint tokens
    const stakerTandemAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection, mintAuthority, tandemMint, staker.publicKey
    );
    stakerTandemAta = stakerTandemAccount.address;
    await mintTo(provider.connection, mintAuthority, tandemMint, stakerTandemAta, mintAuthority, 1_000_000_000); // 1000 TANDEM

    // Create staker's USDC ATA
    const stakerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection, mintAuthority, usdcMint, staker.publicKey
    );
    stakerUsdcAta = stakerUsdcAccount.address;

    // Derive stake account PDA
    [stakeAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), staker.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Staker deposits TANDEM tokens", async () => {
    const stakeAmount = new BN(500_000_000); // 500 TANDEM

    await program.methods
      .stake(stakeAmount)
      .accounts({
        staker: staker.publicKey,
        protocolConfig,
        stakeAccount: stakeAccountPda,
        stakerTandemAta,
        stakeTandemAta,
        stakerRewardAta,
        tandemMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([staker])
      .rpc();

    const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
    expect(stakeAccount.stakedAmount.toNumber()).to.equal(500_000_000);
    expect(stakeAccount.staker.toString()).to.equal(staker.publicKey.toString());

    const config = await program.account.protocolConfig.fetch(protocolConfig);
    expect(config.totalStaked.toNumber()).to.equal(500_000_000);

    // Verify TANDEM transferred
    const stakerBalance = await getAccount(provider.connection, stakerTandemAta);
    expect(Number(stakerBalance.amount)).to.equal(500_000_000); // 500 left
  });

  it("Staker stakes more (timer resets)", async () => {
    const stakeAmount = new BN(200_000_000); // 200 more

    await program.methods
      .stake(stakeAmount)
      .accounts({
        staker: staker.publicKey,
        protocolConfig,
        stakeAccount: stakeAccountPda,
        stakerTandemAta,
        stakeTandemAta,
        stakerRewardAta,
        tandemMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([staker])
      .rpc();

    const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
    expect(stakeAccount.stakedAmount.toNumber()).to.equal(700_000_000); // 500 + 200

    const config = await program.account.protocolConfig.fetch(protocolConfig);
    expect(config.totalStaked.toNumber()).to.equal(700_000_000);
  });

  it("Unstake fails before 7-day lockup", async () => {
    try {
      await program.methods
        .unstake()
        .accounts({
          staker: staker.publicKey,
          protocolConfig,
          stakeAccount: stakeAccountPda,
          stakerTandemAta,
          stakeTandemAta,
          stakerRewardAta,
          tandemMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([staker])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("LockupNotElapsed");
    }
  });

  it("Generate fees via send_usdc, then claim rewards", async () => {
    // Send 50 USDC to generate fees while staker is staked
    const amount = new BN(50_000_000);
    await program.methods
      .sendUsdc(amount)
      .accounts({
        signer: agent.publicKey,
        vault,
        vaultUsdcAta,
        recipientAta,
        whitelistEntry: null,
        ...feeAccounts(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    // Fee = 50M * 25 / 10000 = 125_000. Staker portion = 62_500
    // Staker has 100% of stake, should get all 62_500

    // Claim rewards
    await program.methods
      .claimRewards()
      .accounts({
        staker: staker.publicKey,
        protocolConfig,
        stakeAccount: stakeAccountPda,
        stakerRewardAta,
        stakerUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker])
      .rpc();

    // Verify staker received USDC rewards
    const stakerUsdcBalance = await getAccount(provider.connection, stakerUsdcAta);
    // Staker should have received all the staker reward portion that accumulated
    // from all previous sends since staking
    expect(Number(stakerUsdcBalance.amount)).to.be.greaterThan(0);

    // Verify rewards_owed reset
    const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
    expect(stakeAccount.rewardsOwed.toNumber()).to.equal(0);
  });

  it("No rewards to claim after just claiming", async () => {
    try {
      await program.methods
        .claimRewards()
        .accounts({
          staker: staker.publicKey,
          protocolConfig,
          stakeAccount: stakeAccountPda,
          stakerRewardAta,
          stakerUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("NoRewardsToClaim");
    }
  });

  it("Update protocol config", async () => {
    await program.methods
      .updateProtocolConfig(50) // change to 0.50%
      .accounts({
        authority: human,
        protocolConfig,
        treasuryAta,
      })
      .rpc();

    const config = await program.account.protocolConfig.fetch(protocolConfig);
    expect(config.feeBps).to.equal(50);

    // Reset back to 25 bps
    await program.methods
      .updateProtocolConfig(FEE_BPS)
      .accounts({
        authority: human,
        protocolConfig,
        treasuryAta,
      })
      .rpc();
  });
});
