# Tandem Wallet

Tandem Wallet is a Solana smart account for AI agents. A human wallet owns the vault, an agent wallet can act within policy, and larger or riskier actions are routed to human approval.

The repository contains:

- An Anchor program for vaults, proposals, allowlists, pause controls, fees, and optional staking.
- A Next.js web app for humans to create and manage vaults.
- A local agent connector package with CLI, SDK, and MCP server support.
- Devnet scripts, smoke tests, audit notes, and a mainnet deployment checklist.

Production links:

- Website: https://www.tandemwallet.ai
- App: https://app.tandemwallet.ai
- X: https://x.com/tandemwalletai

## What Tandem Does

Tandem gives an AI agent a constrained wallet surface:

- The human creates a vault and chooses an agent signer.
- The human deposits USDC into the vault.
- The agent can send USDC within the configured per-transaction allowance.
- Whitelisted recipient wallets can receive above-allowance direct sends.
- Above-allowance sends to non-whitelisted recipients become proposals.
- The human can approve or reject proposals in the app.
- The human can pause the vault, change allowance, manage whitelist entries, and withdraw funds.
- The app records direct sends, proposal approvals/rejections, deposits, withdrawals, and explorer links in history.

The agent does not receive the human wallet key. The agent only uses its own Solana keypair, and the on-chain program enforces the vault policy.

## Repository Layout

```text
.
├── app/                         # Next.js Tandem Wallet app
│   ├── src/app/                 # App router pages, API routes, global CSS
│   ├── src/components/          # Vault UI, onboarding, proposals, history, wallet modal
│   ├── src/lib/                 # Program client, PDAs, network config, onboarding state
│   └── scripts/                 # Devnet/admin/smoke scripts
├── programs/tandem-wallet/      # Anchor program
│   └── src/
│       ├── instructions/        # Program instructions
│       ├── state/               # Account state
│       ├── events.rs            # Program events
│       └── errors.rs            # Program errors
├── packages/agent-connector/    # Published agent CLI/SDK/MCP package
├── docs/                        # Connector and authority docs
├── tests/                       # Anchor test suite
├── scripts/                     # Repo-level safety/test scripts
└── MAINNET_DEPLOYMENT_CHECKLIST.md
```

## Core Concepts

**Human owner**

The wallet that creates and owns a vault. The human can approve proposals, change settings, pause/unpause, whitelist recipients, and withdraw vault USDC.

**Agent signer**

The Solana keypair controlled by the AI agent. It can initiate direct sends within policy and create proposals when human approval is required.

**Vault**

A PDA derived from the human wallet and agent wallet. The vault owns the USDC token account and signs token transfers via PDA seeds.

**Spending limit**

The maximum USDC amount the agent can send in a single direct transaction unless the recipient is whitelisted.

**Whitelist**

A human-managed list of recipient wallet addresses that can receive direct agent sends above the normal spending limit.

**Proposal**

An above-limit payment request for a non-whitelisted recipient. The human signs approval or rejection in the app.

**Pause**

Stops agent/proposal activity while preserving human recovery paths.

**Agent SOL**

SOL sent to the agent wallet, not the vault. This pays gas for agent-initiated transactions and proposal creation.

## Current Program

Program ID in this repo:

```text
6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ
```

Configured networks:

- Localnet: `6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ`
- Devnet: `6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ`

The app defaults to devnet through `app/.env.example`.

## On-Chain Instructions

The Anchor program exposes:

- `initialize`: create a vault for a human and agent.
- `send_usdc`: send USDC from the vault when the signer is allowed.
- `propose`: create a human approval proposal with a memo.
- `approve_proposal`: execute an approved proposal.
- `cancel_proposal`: reject/cancel a proposal.
- `close_proposal`: close executed or cancelled proposal accounts.
- `set_limit`: update the vault spending limit.
- `add_whitelist`: add a whitelisted recipient wallet.
- `remove_whitelist`: remove a whitelisted recipient wallet.
- `pause`: pause vault activity.
- `unpause`: resume vault activity.
- `initialize_protocol`: initialize protocol fee and treasury config.
- `update_protocol_fee`: update protocol fee bps.
- `update_treasury`: update treasury USDC account.
- `transfer_protocol_authority`: rotate protocol authority.
- `stake`, `unstake`, `claim_rewards`: optional staking flow gated by the `staking-enabled` feature.

Program events include vault initialization, sends, proposal creation/approval/cancellation, whitelist changes, limit changes, pause/unpause, protocol initialization, staking, unstaking, and reward claims.

## Protocol Fees

The current protocol fee setting is configured through protocol initialization/update scripts. The app and docs use a 0.25% protocol fee example.

Fee routing:

- With staking disabled, fees route to the configured treasury path in the program flow.
- With staking enabled, the documented model is 50% to active stakers as USDC and 50% to Tandem Wallet treasury.

Staking is intentionally disabled in the default vault-first build. See `MAINNET_DEPLOYMENT_CHECKLIST.md` before enabling staking on mainnet.

## Human App Features

The Next.js app supports:

- Wallet connection with Wallet Standard support and visible install options for common Solana wallets.
- First-time guided setup and setup checklist.
- Vault creation with a generated agent keypair or pasted existing agent public key.
- Download agent keypair JSON.
- Manual raw JSON save option for users who prefer not to use browser downloads.
- Agent setup command generation.
- USDC vault deposit and withdrawal.
- Agent SOL top-up.
- Spending limit controls.
- Whitelist management.
- Pause/unpause controls.
- Pending proposal review and final signing review.
- Advanced data dropdowns for dense proposal fields.
- History tab for executed, cancelled, and direct-send activity.
- Bottom-right transaction toasts with progress, close button, and explorer/history links.

## Agent Keypair Setup Options

Tandem supports two setup paths.

### Recommended: Download JSON

When Tandem generates an agent keypair, the app shows a JSON download. The user should give that file to the agent or place it somewhere the agent can access.

Tandem does not store the private key after vault creation.

### Manual Save: Copy Raw JSON

For users who do not want browser downloads:

1. Copy the raw JSON in the Advanced backup section.
2. Paste it into a plain-text editor.
3. Save it with the filename Tandem provides, ending in `.json`.
4. Give that saved file to the agent.

On macOS TextEdit, use `Format > Make Plain Text` before saving. On Windows, ensure Notepad does not save the file as `.json.txt`.

This is the same key material as the downloaded JSON. Treat it like a hot wallet private key.

### Existing Agent Public Key

If the agent already controls a Solana keypair, the user can paste the agent public key during vault creation. In that case, Tandem never generates or handles the private key.

Only use this option when the agent can actually sign with the matching private key.

## Agent Connector

Package:

```text
@tandemwallet/agent
```

Current package version in this repo:

```text
0.1.6
```

The connector provides:

- CLI: `tandem-agent`
- SDK: `packages/agent-connector/src/index.cjs`
- MCP stdio server: `tandem-agent-mcp`
- Local config at `~/.tandem/agent.json`
- Agent guidance at `~/.tandem/agent-instructions.md`

Typical setup command generated by the app:

```sh
npx -y @tandemwallet/agent@latest setup \
  --vault <vault_pda> \
  --rpc-url https://api.devnet.solana.com \
  --program-id 6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ \
  --app-url https://app.tandemwallet.ai
```

The setup flow auto-finds `tandem-agent-keypair*.json` or `agent-keypair.json` in the current folder, `./web`, `~/Downloads`, or `~/.tandem`. A custom path can be passed with `--agent-keypair <path>`.

Agent commands:

```sh
npx @tandemwallet/agent state
npx @tandemwallet/agent send --recipient <recipient_wallet> --amount 0.1
npx @tandemwallet/agent propose --recipient <recipient_wallet> --amount 4 --memo "Payment request"
npx @tandemwallet/agent proposal --proposal <proposal_pda>
npx @tandemwallet/agent proposals --limit 10
npx @tandemwallet/agent mcp
```

MCP tools exposed:

- `get_agent_address`
- `get_vault_state`
- `send_usdc`
- `create_proposal`
- `get_proposal`
- `list_proposals`

See `packages/agent-connector/README.md` and `docs/agent-connector.md`.

## Agent Behavior Rules

The generated agent guidance tells agents to:

- Never ask for or expose private keys.
- Check vault state before spending.
- Use direct send for within-allowance payments.
- Use direct send for whitelisted recipients, even above the base allowance.
- Create proposals for above-allowance payments to non-whitelisted recipients.
- Include useful memos for proposals, such as invoice purpose, API credits, or user-provided purchase context.
- Stop and report the exact error if a transaction fails.
- Avoid automatically falling back to proposal creation if a user explicitly requested direct-send-only behavior.

Current note: direct `send_usdc` events do not include a memo field on-chain. Proposal memos are supported.

## Local Development

Prerequisites:

- Node.js 18+
- npm
- Rust and Cargo
- Solana/Agave CLI
- Anchor 0.30.x-compatible toolchain

Install dependencies:

```sh
npm install
npm install --prefix app
npm install --prefix packages/agent-connector
```

Copy app env:

```sh
cp app/.env.example app/.env.local
```

Run the app:

```sh
npm run dev --prefix app
```

By default the app uses:

```text
NEXT_PUBLIC_NETWORK=devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ
NEXT_PUBLIC_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

Optional hosted metadata sync uses `DATABASE_URL`.

## Validation

Common checks:

```sh
npm run check:secrets
npm run lint
npm run build
```

App-only:

```sh
npm run lint --prefix app
npm run build --prefix app
```

Agent connector syntax/package checks:

```sh
npm run check --prefix packages/agent-connector
npm run pack:check --prefix packages/agent-connector
```

Devnet smoke test:

```sh
npm run smoke:devnet
```

Admin authority check:

```sh
npm run check-admin:devnet
```

Anchor/local tests:

```sh
anchor test --provider.cluster localnet
```

CI-style local validator test helper:

```sh
PATH=/path/to/solana/bin:$PATH LEDGER_DIR=.anchor/ci-local-test bash scripts/run-anchor-tests-ci.sh
```

## Building The Program

Default vault-first build:

```sh
cargo build-sbf --manifest-path programs/tandem-wallet/Cargo.toml --sbf-out-dir target/deploy
```

Staking-enabled build for testing only:

```sh
cargo build-sbf \
  --manifest-path programs/tandem-wallet/Cargo.toml \
  --sbf-out-dir target/deploy \
  --features staking-enabled
```

Do not use `--features staking-enabled` for the vault-first mainnet launch unless the staking rollout has been audited, tested, and explicitly approved.

## Devnet Scripts

Run from the app package or through root scripts where available:

```sh
npm run init-protocol:devnet --prefix app
npm run create-test-vault:devnet --prefix app
npm run set-vault-limit:devnet --prefix app
npm run approve-proposal:devnet --prefix app
npm run agent-send-usdc:devnet --prefix app
npm run update-protocol-fee:devnet --prefix app
npm run transfer-protocol-authority:devnet --prefix app
npm run check-admin:devnet --prefix app
```

Use explicit environment variables for authority, treasury, mint, RPC, and wallet paths. Never commit keypair files or secrets.

## Deployment

The app is deployed with Vercel from `app/`.

Production deploy:

```sh
cd app
npx vercel --prod
```

The website is a separate static project at `/Users/max/Documents/Tandem Site` in this local workspace and deploys to:

```text
https://www.tandemwallet.ai
```

## Mainnet Notes

Before mainnet:

- Read `MAINNET_DEPLOYMENT_CHECKLIST.md`.
- Use fresh mainnet identities.
- Do not reuse devnet/test wallets.
- Use multisig or hardware-backed wallets for long-term authorities.
- Run `npm run check:secrets`.
- Run app, connector, program, and smoke checks.
- Confirm program upgrade authority and protocol authority ownership.
- Deploy from a tagged, tested commit.
- Run real-funds smoke tests with tiny amounts first.

Mainnet USDC mint:

```text
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

Devnet USDC mint used by the app example:

```text
4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

## Security Model

Tandem separates authority:

- Human owner controls vault settings and proposal approval.
- Agent signer can initiate actions only inside program rules.
- Program upgrade authority controls deployable program code.
- Protocol authority controls protocol fee settings and treasury routing.

Important constraints:

- The agent key can spend within allowance.
- Whitelisted recipients bypass the allowance.
- Above-limit non-whitelisted payments require human approval.
- Pausing blocks agent/proposal activity.
- Human recovery remains available through owner controls.
- A compromised program upgrade authority is critical because it can change protocol rules.
- A compromised protocol authority cannot directly drain vaults, but can redirect future fee economics.

See `docs/admin-authorities.md`, `SECURITY_AUDIT.md`, and `SECURITY_AUDIT_2.md`.

## Private Key Safety

Never commit or paste:

- Human wallet private keys.
- Agent keypair JSON.
- Deployer keypairs.
- Protocol authority keypairs.
- Treasury authority keypairs.
- Mainnet RPC secrets.
- Vercel/Neon/database secrets.

Keep agent keypairs outside the repo, for example:

```text
~/.tandem/agent-keypair.json
```

Use restrictive permissions where possible:

```sh
chmod 600 ~/.tandem/agent-keypair.json
```

Run the secret scanner before commits:

```sh
npm run check:secrets
```

## Troubleshooting

**The agent created a proposal instead of direct sending.**

Check vault state, allowance, paused status, whitelist entry, recipient address, and agent package version. Whitelisted recipients should bypass the allowance when the connector is current.

**The app history is delayed.**

Direct send history is derived from transaction/event polling and the `/api/vault-history` route. Check RPC health and whether the transaction finalized.

**The agent setup command cannot find the keypair file.**

Place `tandem-agent-keypair*.json` in the current folder, `./web`, `~/Downloads`, or `~/.tandem`, or pass `--agent-keypair <path>`.

**The agent wallet has no SOL.**

Top up Agent SOL from the app. This goes to the agent wallet and pays transaction fees.

**Wallet options are missing after hard refresh.**

The app re-announces Wallet Standard readiness and shows install entries for common wallets. Click Refresh Wallets in the wallet modal if an extension registers late.

## Reference Docs

- `packages/agent-connector/README.md`
- `docs/agent-connector.md`
- `docs/admin-authorities.md`
- `MAINNET_DEPLOYMENT_CHECKLIST.md`
- `SECURITY_AUDIT.md`
- `SECURITY_AUDIT_2.md`
- `Claude Audit Review.md`
- `CLAUDE_AUDIT_REVIEW_2.md`

## License

This repository is currently not published under an open-source license. The agent connector package is marked `UNLICENSED`.
