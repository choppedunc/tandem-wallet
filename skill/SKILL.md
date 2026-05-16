---
name: tandem
description: >-
  Manage a Tandem Wallet smart account on Solana. Check vault balances and status,
  send USDC (auto-proposing anything over the spending limit), list and inspect
  pending proposals, and preview whether an amount needs human approval. Use when
  the user asks about their vault, wants to send USDC, check balances, or manage
  proposals.
compatibility: Requires Node.js 18+ and network access to a Solana RPC endpoint.
allowed-tools: Bash Read
---

# Tandem Wallet Skill

## Setup

Run these commands to download the scripts and install dependencies:
```bash
npx degit choppedunc/tandem-wallet/skill/scripts tandem
cd tandem
npm install
```

Then generate your wallet keypair:
```bash
node -r ts-node/register generate-keypair.ts
```

This outputs your public key and private key. Save these — the public key is your wallet address for receiving USDC.

All scripts must be run from the `tandem/` directory. No other configuration needed — devnet credentials are built in.

If on Node.js 24+, use `node --no-experimental-strip-types -r ts-node/register` instead of `node -r ts-node/register` for all commands below.

## Spending Authority

| Condition | Action |
|-----------|--------|
| Recipient is whitelisted | Execute immediately, no amount limit |
| Amount ≤ vault spending limit | Execute immediately |
| Amount > vault spending limit | Creates a proposal — needs human approval |

The human owner sets the spending limit. Setting it to `0` means every send
requires human approval.

## Available Operations

### Check Vault Status
```bash
node -r ts-node/register vault-status.ts
```
Returns: human, agent, spending limit, paused state, USDC balance, SOL balance, proposal count.

### Check Balance
```bash
node -r ts-node/register vault-balance.ts
```
Returns: SOL and USDC balances only.

### Send USDC
```bash
node -r ts-node/register send-usdc.ts <recipient> <amount>
```
- `recipient`: Wallet address (base58)
- `amount`: USDC amount (e.g., "50" for 50 USDC)

If the amount is within the vault's spending limit (or the recipient is
whitelisted), the send executes immediately. Otherwise the script creates a
proposal that the human must approve.

### List Proposals
```bash
node -r ts-node/register list-proposals.ts [pending|executed|cancelled|all]
```
Default filter is `pending`.

### Get Proposal Details
```bash
node -r ts-node/register get-proposal.ts <proposal_id>
```

### Preview a Send
```bash
node -r ts-node/register preview-send.ts <amount>
```
Preview whether an amount would execute immediately or create a proposal,
without sending anything.

## Error Handling

All scripts output JSON. On success, the result is printed to stdout. On failure, an error JSON is printed to stderr.

| Error | Meaning |
|-------|---------|
| VaultPaused | Vault is paused by human owner — cannot send |
| OverSpendingLimit | Amount exceeds spending limit — `send-usdc` will auto-propose instead |
| ZeroAmount | Cannot send 0 USDC |

## Safety Notes

- Always verify recipient addresses before sending
- Use `preview-send` before sending to preview the action
- The agent can spend up to the vault's spending limit autonomously, and can bypass that limit for whitelisted recipients
- Larger amounts to non-whitelisted recipients require human approval
