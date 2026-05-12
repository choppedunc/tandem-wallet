const anchor = require("@coral-xyz/anchor");
const {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

const USDC_DECIMALS = 6n;
const USDC_SCALE = 10n ** USDC_DECIMALS;
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_PROGRAM_ID = "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ";
const DEFAULT_CONFIG_PATH = "~/.tandem/agent.json";

function repoRoot() {
  return path.resolve(__dirname, "../../..");
}

function expandPath(filePath) {
  if (!filePath) return filePath;
  return filePath.replace(/^~(?=$|\/|\\)/, os.homedir());
}

function defaultConfigPath() {
  return expandPath(process.env.TANDEM_AGENT_CONFIG || DEFAULT_CONFIG_PATH);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(expandPath(filePath), "utf8"));
}

function writePrivateJson(filePath, value) {
  const expanded = expandPath(filePath);
  ensureDir(path.dirname(expanded));
  fs.writeFileSync(expanded, `${JSON.stringify(value, null, 2)}\n`);
  fs.chmodSync(expanded, 0o600);
}

function readKeypair(filePath) {
  const expanded = expandPath(filePath);
  const raw = JSON.parse(fs.readFileSync(expanded, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function parseUsdc(value) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error(
      "Amount must be a positive USDC value with up to 6 decimals."
    );
  }

  const [whole, fraction = ""] = normalized.split(".");
  const raw =
    BigInt(whole) * USDC_SCALE +
    BigInt(fraction.padEnd(Number(USDC_DECIMALS), "0"));
  if (raw <= 0n) throw new Error("Amount must be greater than zero.");
  return raw;
}

function formatUsdc(rawValue) {
  const raw = BigInt(rawValue);
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const whole = absolute / USDC_SCALE;
  const fraction = (absolute % USDC_SCALE)
    .toString()
    .padStart(Number(USDC_DECIMALS), "0");
  return `${negative ? "-" : ""}${whole}.${fraction} USDC`;
}

function bn(value) {
  return new anchor.BN(BigInt(value).toString());
}

function toBase58(value) {
  return value instanceof PublicKey
    ? value.toBase58()
    : new PublicKey(value).toBase58();
}

function protocolConfigPda(programId) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );
  return pda;
}

function proposalPda(programId, vault, proposalId) {
  const id = bn(proposalId);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("proposal"),
      vault.toBuffer(),
      id.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return pda;
}

function whitelistPda(programId, vault, recipient) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), vault.toBuffer(), recipient.toBuffer()],
    programId
  );
  return pda;
}

function loadIdl() {
  const candidates = [
    process.env.TANDEM_AGENT_IDL,
    path.join(__dirname, "../idl/tandem_wallet.json"),
    path.join(repoRoot(), "app/src/lib/idl.json"),
  ].filter(Boolean);

  const idlPath = candidates
    .map((candidate) => path.resolve(expandPath(candidate)))
    .find((candidate) => fs.existsSync(candidate));
  if (!idlPath) {
    throw new Error(
      "Tandem Wallet IDL not found. Reinstall @tandemwallet/agent or set TANDEM_AGENT_IDL."
    );
  }

  const idl = require(idlPath);
  return JSON.parse(JSON.stringify(idl));
}

function createProgram({ connection, keypair, programId }) {
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  idl.address = programId.toBase58();
  return new anchor.Program(idl, provider);
}

async function tokenBalance(connection, address) {
  try {
    const balance = await connection.getTokenAccountBalance(address);
    return {
      raw: balance.value.amount,
      uiAmountString: balance.value.uiAmountString || "0",
    };
  } catch {
    return { raw: "0", uiAmountString: "0" };
  }
}

function proposalStatus(proposal) {
  if (proposal.executed) return "executed";
  if (proposal.cancelled) return "cancelled";
  return "pending";
}

function normalizeProposal(proposal, address) {
  return {
    address: toBase58(address),
    vault: proposal.vault.toBase58(),
    proposalId: proposal.proposalId.toString(),
    recipient: proposal.recipient.toBase58(),
    recipientAta: proposal.recipientAta.toBase58(),
    amountRaw: proposal.amount.toString(),
    amountUsdc: formatUsdc(proposal.amount.toString()),
    proposedAt: Number(proposal.proposedAt.toString()),
    executed: Boolean(proposal.executed),
    cancelled: Boolean(proposal.cancelled),
    status: proposalStatus(proposal),
    memo: proposal.memo,
  };
}

class TandemAgentClient {
  constructor(options) {
    const agentKeypair =
      options.agentKeypair || readKeypair(options.agentKeypairPath);
    this.rpcUrl = options.rpcUrl || DEFAULT_RPC_URL;
    this.programId = new PublicKey(options.programId || DEFAULT_PROGRAM_ID);
    this.agentKeypair = agentKeypair;
    this.connection =
      options.connection || new Connection(this.rpcUrl, "confirmed");
    this.program = createProgram({
      connection: this.connection,
      keypair: this.agentKeypair,
      programId: this.programId,
    });
    this.protocolConfig = protocolConfigPda(this.programId);
  }

  async getProtocolConfig() {
    const config = await this.program.account.protocolConfig.fetch(
      this.protocolConfig
    );
    return {
      address: this.protocolConfig.toBase58(),
      authority: config.authority.toBase58(),
      feeBps: Number(config.feeBps),
      usdcMint: config.usdcMint.toBase58(),
      tandemMint: config.tandemMint.toBase58(),
      stakerRewardAta: config.stakerRewardAta.toBase58(),
      treasuryAta: config.treasuryAta.toBase58(),
      totalStaked: config.totalStaked.toString(),
    };
  }

  async getVault(vaultAddress) {
    const vault = new PublicKey(vaultAddress);
    return this.program.account.vault.fetch(vault);
  }

  async getVaultState(vaultAddress) {
    const vault = new PublicKey(vaultAddress);
    const account = await this.getVault(vault);
    const config = await this.getProtocolConfig();
    const balance = await tokenBalance(this.connection, account.vaultUsdcAta);
    return {
      vault: vault.toBase58(),
      human: account.human.toBase58(),
      agent: account.agent.toBase58(),
      localAgent: this.agentKeypair.publicKey.toBase58(),
      agentMatches: account.agent.equals(this.agentKeypair.publicKey),
      usdcMint: account.usdcMint.toBase58(),
      vaultUsdcAta: account.vaultUsdcAta.toBase58(),
      balance,
      spendingLimitRaw: account.spendingLimit.toString(),
      spendingLimitUsdc: formatUsdc(account.spendingLimit.toString()),
      paused: Boolean(account.paused),
      proposalCount: account.proposalCount.toString(),
      protocol: config,
    };
  }

  async assertAgent(vaultAddress) {
    const vault = await this.getVault(vaultAddress);
    if (!vault.agent.equals(this.agentKeypair.publicKey)) {
      throw new Error(
        `Agent key mismatch. Vault expects ${vault.agent.toBase58()}, local signer is ${this.agentKeypair.publicKey.toBase58()}.`
      );
    }
    return vault;
  }

  async sendUsdc({ vault, recipient, amountUsdc, allowWhitelisted = false }) {
    const vaultAddress = new PublicKey(vault);
    const recipientWallet = new PublicKey(recipient);
    const amountRaw = parseUsdc(amountUsdc);
    const vaultAccount = await this.assertAgent(vaultAddress);

    if (vaultAccount.paused) {
      throw new Error(
        "Vault is paused. Human must unpause before agent actions can continue."
      );
    }

    const recipientAta = getAssociatedTokenAddressSync(
      vaultAccount.usdcMint,
      recipientWallet
    );
    const recipientAtaInfo = await this.connection.getAccountInfo(recipientAta);
    const createdRecipientAta = !recipientAtaInfo;
    const preInstructions = createdRecipientAta
      ? [
          createAssociatedTokenAccountInstruction(
            this.agentKeypair.publicKey,
            recipientAta,
            recipientWallet,
            vaultAccount.usdcMint
          ),
        ]
      : [];

    let whitelistEntry = null;
    if (allowWhitelisted) {
      const candidate = whitelistPda(
        this.programId,
        vaultAddress,
        recipientWallet
      );
      if (await this.connection.getAccountInfo(candidate)) {
        whitelistEntry = candidate;
      }
    }

    if (
      !whitelistEntry &&
      amountRaw > BigInt(vaultAccount.spendingLimit.toString())
    ) {
      throw new Error(
        `Amount ${formatUsdc(amountRaw)} exceeds spending limit ${formatUsdc(
          vaultAccount.spendingLimit.toString()
        )}. Use createProposal instead.`
      );
    }

    const config = await this.program.account.protocolConfig.fetch(
      this.protocolConfig
    );
    const signature = await this.program.methods
      .sendUsdc(bn(amountRaw))
      .accounts({
        signer: this.agentKeypair.publicKey,
        vault: vaultAddress,
        vaultUsdcAta: vaultAccount.vaultUsdcAta,
        recipientAta,
        whitelistEntry,
        protocolConfig: this.protocolConfig,
        stakerRewardAta: config.stakerRewardAta,
        treasuryAta: config.treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions(preInstructions)
      .signers([this.agentKeypair])
      .rpc();

    return {
      signature,
      vault: vaultAddress.toBase58(),
      recipient: recipientWallet.toBase58(),
      recipientAta: recipientAta.toBase58(),
      amountRaw: amountRaw.toString(),
      amountUsdc: formatUsdc(amountRaw),
      usedWhitelist: Boolean(whitelistEntry),
      createdRecipientAta,
    };
  }

  async createProposal({
    vault,
    recipient,
    amountUsdc,
    memo = "Tandem Wallet agent request",
  }) {
    if (memo.length > 128)
      throw new Error("Memo must be 128 characters or fewer.");

    const vaultAddress = new PublicKey(vault);
    const recipientWallet = new PublicKey(recipient);
    const amountRaw = parseUsdc(amountUsdc);
    const vaultAccount = await this.assertAgent(vaultAddress);
    if (vaultAccount.paused) {
      throw new Error(
        "Vault is paused. Human must unpause before agent proposals can continue."
      );
    }

    const recipientAta = getAssociatedTokenAddressSync(
      vaultAccount.usdcMint,
      recipientWallet
    );
    const proposalId = vaultAccount.proposalCount;
    const proposal = proposalPda(this.programId, vaultAddress, proposalId);

    const signature = await this.program.methods
      .propose(bn(amountRaw), memo)
      .accounts({
        agent: this.agentKeypair.publicKey,
        vault: vaultAddress,
        recipient: recipientWallet,
        protocolConfig: this.protocolConfig,
        recipientAta,
        proposal,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.agentKeypair])
      .rpc();

    return {
      signature,
      vault: vaultAddress.toBase58(),
      proposal: proposal.toBase58(),
      proposalId: proposalId.toString(),
      recipient: recipientWallet.toBase58(),
      recipientAta: recipientAta.toBase58(),
      amountRaw: amountRaw.toString(),
      amountUsdc: formatUsdc(amountRaw),
      memo,
    };
  }

  async listProposals({ vault, limit = 10 }) {
    const vaultAddress = new PublicKey(vault);
    const vaultAccount = await this.getVault(vaultAddress);
    const count = BigInt(vaultAccount.proposalCount.toString());
    const cappedLimit = Math.max(1, Math.min(Number(limit), 50));
    const start =
      count > BigInt(cappedLimit) ? count - BigInt(cappedLimit) : 0n;
    const proposals = [];

    for (let id = count; id > start; id -= 1n) {
      const proposalId = id - 1n;
      const address = proposalPda(this.programId, vaultAddress, proposalId);
      try {
        const proposal = await this.program.account.proposal.fetch(address);
        proposals.push(normalizeProposal(proposal, address));
      } catch {
        proposals.push({
          address: address.toBase58(),
          proposalId: proposalId.toString(),
          status: "missing-or-closed",
        });
      }
    }

    return {
      vault: vaultAddress.toBase58(),
      proposalCount: count.toString(),
      proposals,
    };
  }
}

function loadAgentConfig(configPath = defaultConfigPath()) {
  const config = readJson(configPath);
  return {
    rpcUrl: config.rpcUrl || DEFAULT_RPC_URL,
    programId: config.programId || DEFAULT_PROGRAM_ID,
    vault: config.vault,
    agentKeypairPath: config.agentKeypairPath,
    configPath: expandPath(configPath),
  };
}

function clientFromConfig(configPath = defaultConfigPath()) {
  const config = loadAgentConfig(configPath);
  if (!config.agentKeypairPath)
    throw new Error("agentKeypairPath is missing from Tandem config.");
  return {
    config,
    client: new TandemAgentClient(config),
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_PROGRAM_ID,
  DEFAULT_RPC_URL,
  TandemAgentClient,
  clientFromConfig,
  defaultConfigPath,
  expandPath,
  formatUsdc,
  loadAgentConfig,
  parseUsdc,
  readKeypair,
  writePrivateJson,
};
