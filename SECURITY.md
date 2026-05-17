# Security Policy

Tandem Wallet is security-sensitive software for Solana vaults and AI-agent payments. Please report suspected vulnerabilities privately before making them public.

## Supported Scope

Security reports are in scope for:

- The Anchor program in `programs/tandem-wallet`.
- The Tandem Wallet web app in `app`.
- The agent connector CLI, SDK, and MCP server in `packages/agent-connector`.
- Deployment, signing, and configuration flows documented in this repository.

Out of scope:

- Issues in third-party wallets, wallet extensions, RPC providers, block explorers, or hosting providers.
- Social engineering or physical attacks.
- Spam, denial-of-service without a concrete exploit path, or reports based only on automated scanner output.

## Reporting A Vulnerability

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for this repository.
2. If that is unavailable, contact the maintainers privately and request a security channel.
3. Do not open a public issue, pull request, or social post with exploit details before the issue has been triaged and patched.

Public contact for routing only:

- X: https://x.com/tandemwalletai
- Website: https://www.tandemwallet.ai

When reporting, include:

- Affected component: program, app, agent connector, docs, deployment, or another area.
- Network or environment: localnet, devnet, mainnet, hosted app, or CLI.
- Steps to reproduce.
- Expected impact.
- Transaction signatures, logs, or screenshots if useful.
- Whether funds or private key material may be at risk.

## Safe Harbor

Good-faith research is welcome when it:

- Avoids accessing or modifying other users' funds, wallets, data, or private keys.
- Uses localnet, devnet, or accounts you control.
- Avoids public disclosure before maintainers have had a reasonable chance to respond.
- Avoids destructive testing against production systems.

## Private Key Handling

Never send private keys, seed phrases, deployer keypairs, agent keypair JSON files, or production secrets in a report. If a vulnerability requires proving access to secret material, describe the proof without transmitting the secret itself.

## Known Security Model

Tandem separates authority between:

- Human owner wallet.
- Agent signer wallet.
- Program upgrade authority.
- Protocol authority.

Important constraints:

- The agent signer can spend within the configured vault policy.
- Whitelisted recipients can receive direct sends above the base allowance.
- Above-allowance sends to non-whitelisted recipients require human approval.
- Pausing a vault blocks agent/proposal activity while preserving human recovery controls.
- Program upgrade authority compromise is critical because an upgrade can change protocol rules.
- Protocol authority compromise can affect future fee settings and treasury routing.

## Public Audit Material

This public repository intentionally avoids raw internal audit notes, unresolved exploit details, private deployment checklists, and operational key-management details. Final public audit reports may be published separately when they are intentionally prepared for disclosure.
