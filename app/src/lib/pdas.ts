import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PROGRAM_ID } from "./network";

export function vaultPda(human: PublicKey, agent: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), human.toBuffer(), agent.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function proposalPda(vault: PublicKey, proposalId: BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), vault.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
  return pda;
}

export function whitelistPda(vault: PublicKey, address: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), vault.toBuffer(), address.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function protocolConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    PROGRAM_ID
  );
  return pda;
}
