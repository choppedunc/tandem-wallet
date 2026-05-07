import type { Program } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";

export type AccountEntry<T> = {
  publicKey: PublicKey;
  account: T;
};

export type AccountClient<T> = {
  all(filters?: unknown[]): Promise<AccountEntry<T>[]>;
  fetch(address: PublicKey): Promise<T>;
};

export type VaultAccount = {
  human: PublicKey;
  agent: PublicKey;
  usdcMint: PublicKey;
  vaultUsdcAta: PublicKey;
  spendingLimit: BN;
  paused: boolean;
  proposalCount: BN;
};

export type ProposalAccount = {
  proposalId: BN;
  recipient: PublicKey;
  recipientAta: PublicKey;
  amount: BN;
  proposedAt: BN;
  executed: boolean;
  cancelled: boolean;
  memo: string;
};

export type ProtocolConfigAccount = {
  feeBps: number;
  stakerRewardAta: PublicKey;
  treasuryAta: PublicKey;
};

export type WhitelistEntryAccount = {
  address: PublicKey;
  addedAt: BN;
};

type MethodBuilder = {
  accounts(accounts: Record<string, unknown>): {
    rpc(): Promise<string>;
  };
};

export type TandemProgram = Program & {
  account: {
    vault: AccountClient<VaultAccount>;
    proposal: AccountClient<ProposalAccount>;
    protocolConfig: AccountClient<ProtocolConfigAccount>;
    whitelistEntry: AccountClient<WhitelistEntryAccount>;
  };
  methods: {
    initialize(spendingLimit: BN): MethodBuilder;
    setLimit(spendingLimit: BN): MethodBuilder;
    sendUsdc(amount: BN): MethodBuilder;
    approveProposal(): MethodBuilder;
    cancelProposal(): MethodBuilder;
    addWhitelist(address: PublicKey): MethodBuilder;
    removeWhitelist(): MethodBuilder;
    pause(): MethodBuilder;
    unpause(): MethodBuilder;
  };
};

export function asTandemProgram(program: Program): TandemProgram {
  return program as unknown as TandemProgram;
}
