# Tandem Wallet Reference

## Program Architecture

Tandem Wallet is a PDA-based smart account on Solana that gives AI agents controlled access to USDC funds.

### Account Structure

- **Vault PDA**: `["vault", human_pubkey, agent_pubkey]` — Stores configuration and owns USDC
- **Proposal PDA**: `["proposal", vault_pubkey, proposal_id_le_bytes]` — Pending large transfers
- **WhitelistEntry PDA**: `["whitelist", vault_pubkey, address]` — Trusted recipients

### Spending Authority

The vault uses a single spending limit:
1. **Whitelist bypass**: Whitelisted recipients have no spending limit
2. **At or below `spending_limit`**: Agent can send autonomously
3. **Above `spending_limit`**: Requires proposal → human approval

The human owner can change `spending_limit` at any time via `set_limit`. Setting
it to `0` means every agent send requires human approval.

### Security Model

- Human has full control: can send, pause, unpause, set the spending limit, manage whitelist
- Agent has limited control: can send up to the spending limit, propose, close proposals
- Vault is paused → agent cannot send or propose
- Human can always send, even when paused
