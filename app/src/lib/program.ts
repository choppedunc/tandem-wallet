import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import idl from "./idl.json";
import { asTandemProgram, type TandemProgram } from "./anchorTypes";

const tandemIdl = idl as unknown as Idl;

export function getProgram(connection: Connection, wallet: AnchorWallet): TandemProgram {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return asTandemProgram(new Program(tandemIdl, provider));
}

export function getReadOnlyProgram(connection: Connection): TandemProgram {
  // Read-only provider for fetching accounts when no wallet is connected.
  // We use a dummy wallet — no signing is performed.
  const dummyWallet = {
    publicKey: PublicKey.default,
    signTransaction: async () => { throw new Error("read-only"); },
    signAllTransactions: async () => { throw new Error("read-only"); },
  } as unknown as AnchorWallet;
  const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
  return asTandemProgram(new Program(tandemIdl, provider));
}
