# Tandem Agent Connector

The Tandem Agent Connector is the local, decentralized onboarding path for AI agents.

It gives an agent a narrow Tandem Wallet tool surface instead of asking the agent to understand
Anchor accounts, PDAs, token accounts, or private-key handling.

## What It Provides

- SDK: `packages/agent-connector/src/index.cjs`
- CLI: `packages/agent-connector/bin/tandem-agent.cjs`
- MCP stdio server: `packages/agent-connector/bin/tandem-agent-mcp.cjs`
- Generated agent instruction file: `~/.tandem/TANDEM_AGENT_INSTRUCTIONS.md`

## Security Model

The connector stores only:

- RPC URL
- program ID
- vault address
- local path to the agent keypair file

It does not copy private key material into the config file.

Do not store mainnet agent keypairs in this repo. Use a local path outside the project, for example:

```sh
~/.tandem/agent-keypair.json
```

The agent key can spend within the vault policy limits. Above-limit spends require a human approval
proposal, but a compromised agent key can still attempt under-limit activity. Before mainnet, the
remaining safety upgrades should include rolling spend caps and agent key rotation.

## Setup

After a human creates a vault, download the generated agent keypair JSON file from the app.
The CLI expects a standard Solana keypair JSON array, not the base58 private key.

Move the downloaded file to the local machine that will run the agent:

```sh
mkdir -p ~/.tandem
mv ~/Downloads/agent-keypair.json ~/.tandem/agent-keypair.json
chmod 600 ~/.tandem/agent-keypair.json
```

Then run:

```sh
npm run agent -- setup \
  --vault <vault_pda> \
  --agent-keypair ~/.tandem/agent-keypair.json \
  --rpc-url https://api.devnet.solana.com \
  --program-id 6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ
```

This writes:

```text
~/.tandem/agent.json
~/.tandem/TANDEM_AGENT_INSTRUCTIONS.md
```

The command also prints an MCP server config block. In a future published package this becomes the
one-line user flow:

```sh
npx @tandemwallet/agent setup --vault <vault_pda> --agent-keypair <path>
```

## CLI Usage

Fetch vault state:

```sh
npm run agent -- state
```

Send within allowance:

```sh
npm run agent -- send --recipient <recipient_wallet> --amount 0.1
```

Create a human approval proposal:

```sh
npm run agent -- propose --recipient <recipient_wallet> --amount 4 --memo "Pay invoice"
```

List recent proposals:

```sh
npm run agent -- proposals --limit 10
```

## MCP Tools

Start the MCP server:

```sh
npm run agent:mcp
```

Tools exposed:

- `get_agent_address`
- `get_vault_state`
- `send_usdc`
- `create_proposal`
- `list_proposals`

The MCP server expects newline-delimited JSON-RPC over stdio and reads config from
`TANDEM_AGENT_CONFIG` or `~/.tandem/agent.json`.

## Agent Instruction Rules

The generated instruction file tells the agent:

- never ask for or expose private keys
- always check vault state before sending
- use `send_usdc` only within allowance
- use `create_proposal` above allowance
- stop if recipient token accounts are missing or transactions fail

## Next Work

- Add rolling daily/weekly caps on-chain.
- Add agent key rotation on-chain and in the app.
- Add a first-class `Connect agent` UI that generates the setup command.
- Add optional managed signer support, such as Privy, after the local path is stable.
