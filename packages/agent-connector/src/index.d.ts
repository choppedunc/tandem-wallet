import { Connection, Keypair } from "@solana/web3.js";

export interface TandemAgentOptions {
  rpcUrl?: string;
  programId?: string;
  agentKeypair?: Keypair;
  agentKeypairPath?: string;
  connection?: Connection;
}

export interface TandemAgentConfig {
  rpcUrl: string;
  programId: string;
  vault?: string;
  agentKeypairPath: string;
  configPath?: string;
}

export class TandemAgentClient {
  constructor(options: TandemAgentOptions);
  getProtocolConfig(): Promise<Record<string, unknown>>;
  getVault(vaultAddress: string): Promise<unknown>;
  getVaultState(vaultAddress: string): Promise<Record<string, unknown>>;
  sendUsdc(args: {
    vault: string;
    recipient: string;
    amountUsdc: string;
    allowWhitelisted?: boolean;
  }): Promise<Record<string, unknown>>;
  createProposal(args: {
    vault: string;
    recipient: string;
    amountUsdc: string;
    memo?: string;
  }): Promise<Record<string, unknown>>;
  listProposals(args: {
    vault: string;
    limit?: number;
  }): Promise<Record<string, unknown>>;
}

export function clientFromConfig(configPath?: string): {
  config: TandemAgentConfig;
  client: TandemAgentClient;
};
export function defaultConfigPath(): string;
export function expandPath(filePath: string): string;
export function formatUsdc(rawValue: bigint | string | number): string;
export function formatSol(rawValue: bigint | string | number): string;
export function loadAgentConfig(configPath?: string): TandemAgentConfig;
export function parseUsdc(value: string): bigint;
export function readKeypair(filePath: string): Keypair;
export function writePrivateJson(filePath: string, value: unknown): void;
