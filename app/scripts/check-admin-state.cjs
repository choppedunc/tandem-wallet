const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");

const idl = require("../src/lib/idl.json");

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

function parseProgramData(accountInfo) {
  if (!accountInfo) {
    throw new Error("ProgramData account was not found.");
  }

  const data = accountInfo.data;
  const state = data.readUInt32LE(0);
  if (state !== 3) {
    throw new Error(`Expected ProgramData state 3, got ${state}.`);
  }

  const lastDeploySlot = data.readBigUInt64LE(4).toString();
  const hasUpgradeAuthority = data[12] === 1;
  const upgradeAuthority = hasUpgradeAuthority
    ? new PublicKey(data.subarray(13, 45)).toBase58()
    : null;

  return {
    lastDeploySlot,
    upgradeAuthority,
    immutable: upgradeAuthority === null,
  };
}

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID || "6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ"
  );

  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(anchor.web3.Keypair.generate());
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

  const [config, programAccountInfo, programDataInfo] = await Promise.all([
    program.account.protocolConfig.fetch(protocolConfig),
    connection.getAccountInfo(programId),
    connection.getAccountInfo(programData),
  ]);

  if (!programAccountInfo) {
    throw new Error("Program account was not found.");
  }

  const programOwner = programAccountInfo.owner.toBase58();
  const programDataState = parseProgramData(programDataInfo);
  const protocolAuthority = config.authority.toBase58();
  const authoritiesMatch = programDataState.upgradeAuthority === protocolAuthority;

  const report = {
    status: authoritiesMatch || programDataState.immutable ? "ok" : "warning",
    rpcUrl,
    programId: programId.toBase58(),
    programOwner,
    protocolConfig: protocolConfig.toBase58(),
    protocolAuthority,
    programData: programData.toBase58(),
    upgradeAuthority: programDataState.upgradeAuthority,
    programImmutable: programDataState.immutable,
    lastDeploySlot: programDataState.lastDeploySlot,
    authoritiesMatch,
    feeBps: Number(config.feeBps),
    treasuryAta: config.treasuryAta.toBase58(),
    note: programDataState.immutable
      ? "Program code is immutable; protocol authority can still update fee and treasury config."
      : authoritiesMatch
        ? "Protocol authority and program upgrade authority are currently the same wallet."
        : "Protocol authority and program upgrade authority differ. This may be intentional, but should be documented.",
  };

  console.log(JSON.stringify(report, null, 2));

  if (
    process.env.REQUIRE_AUTHORITY_MATCH === "true"
    && !authoritiesMatch
    && !programDataState.immutable
  ) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
