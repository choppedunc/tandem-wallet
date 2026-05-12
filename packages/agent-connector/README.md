# Tandem Wallet Agent Connector

Local CLI, SDK, and MCP server for Tandem Wallet agents.

The connector lets an agent use a Tandem vault without learning Solana account
details. The agent keypair stays in a local Solana keypair JSON file. The
agent wallet needs a small amount of SOL to pay transaction fees and create
recipient USDC token accounts when needed.

## Setup

Create a vault in the Tandem Wallet app, download the generated
`agent-keypair.json`, then place it on the machine running the agent:

```sh
mkdir -p ~/.tandem
mv ~/Downloads/agent-keypair.json ~/.tandem/agent-keypair.json
chmod 600 ~/.tandem/agent-keypair.json
```

Run setup:

```sh
npx @tandemwallet/agent setup \
  --vault <vault_pda> \
  --agent-keypair ~/.tandem/agent-keypair.json \
  --rpc-url https://api.devnet.solana.com \
  --program-id 6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ \
  --app-url http://localhost:3000
```

This writes local config to `~/.tandem/agent.json`.
For mobile approval links, set `--app-url` to the deployed Tandem Wallet app
URL. `localhost` links only work on the same machine running the app.

## CLI

Check the vault:

```sh
npx @tandemwallet/agent state
```

The state output includes the agent wallet's SOL balance. If it is `0 SOL`,
fund the agent wallet before sending or proposing transactions.

Send within allowance:

```sh
npx @tandemwallet/agent send --recipient <recipient_wallet> --amount 0.1
```

If the recipient has never received this USDC mint before, the connector creates
their associated token account before sending.

Create a human approval proposal:

```sh
npx @tandemwallet/agent propose \
  --recipient <recipient_wallet> \
  --amount 4 \
  --memo "Payment request"
```

Proposal output includes `messageForHuman` and `approvalUrl`. Share those with
the human so they can open the app directly to the pending proposal.

Check a proposal's latest status:

```sh
npx @tandemwallet/agent proposal --proposal <proposal_pda>
```

List recent proposals:

```sh
npx @tandemwallet/agent proposals --limit 10
```

## MCP

Start the MCP stdio server:

```sh
npx @tandemwallet/agent mcp
```

Tools exposed:

- `get_agent_address`
- `get_vault_state`
- `send_usdc`
- `create_proposal`
- `get_proposal`
- `list_proposals`

## Security

- Do not paste mainnet private keys into chats, prompts, or repo files.
- Keep `agent-keypair.json` outside project folders.
- The agent signer can spend within the vault policy limits.
- Above-limit payments are proposals that require human approval.
- If a transaction fails, stop and report the exact error.
