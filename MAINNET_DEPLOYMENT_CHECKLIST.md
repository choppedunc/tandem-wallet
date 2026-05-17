# Tandem Wallet Mainnet Deployment Checklist

This is the public mainnet checklist for Tandem Wallet. Keep private signer paths, authority addresses before announcement, RPC credentials, treasury setup details, and unresolved audit findings out of this document.

Staking is intentionally disabled in the default vault-first build. Do not enable staking for mainnet unless a separate staking rollout has been reviewed, tested, and approved.

## Non-Negotiables

- Do not paste mainnet private keys into chat, docs, screenshots, tickets, or GitHub.
- Do not store deployer, authority, treasury, mint, or agent keypairs inside this repo.
- Use fresh mainnet identities. Do not reuse devnet/test wallets for mainnet authority roles.
- Use multisig or hardware-backed wallets for long-term authorities.
- Deploy from a tagged, reviewed, tested commit.
- Run real-funds smoke tests with tiny amounts first.

## Public Mainnet Constants

Mainnet USDC mint:

```text
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

Program ID, protocol authority, upgrade authority, treasury, TANDEM mint, and deployment metadata should be published only after they are finalized and verified.

## Pre-Deploy Checks

- Confirm `git status` has no unexpected tracked changes.
- Confirm local keypair files, private notes, audit scratch files, and `.env` files are not staged.
- Run the secret scanner:

```sh
npm run check:secrets
```

- Run app checks:

```sh
npm run lint
npm run build
```

- Run connector checks:

```sh
npm run check --prefix packages/agent-connector
npm run pack:check --prefix packages/agent-connector
```

- Run program checks:

```sh
cargo test --workspace
anchor test --skip-build --provider.cluster localnet
```

## Mainnet Build Rule

For the vault-first launch, build without the staking feature:

```sh
cargo build-sbf --manifest-path programs/tandem-wallet/Cargo.toml --sbf-out-dir target/deploy
```

Do not use `--features staking-enabled` for the vault-first mainnet launch.

## Deployment Rules

- Use explicit mainnet environment values.
- Keep private environment values in a local shell, CI secret store, or deployment secret store.
- Keep deployer and authority key material outside the repo.
- Confirm the deployed program, ProgramData account, upgrade authority, protocol config, treasury routing, USDC mint, and app environment values independently after deployment.
- Transfer long-term authority roles to the intended multisig or hardware-backed controls before public launch.

## Smoke Tests With Tiny Amounts

Before public launch, test with tiny mainnet amounts:

- Create one vault.
- Deposit a small amount of Agent SOL.
- Deposit a small amount of mainnet USDC.
- Execute one within-allowance transaction.
- Submit one over-allowance proposal and approve it.
- Submit one over-allowance proposal and reject it.
- Test whitelist behavior.
- Test paused vault behavior.
- Test human USDC withdrawal with `MAX`.
- Confirm history, balances, proposal notifications, and explorer links in the web app.

## Staking Later

Staking calls are blocked in the default build by `StakingDisabled`.

Before enabling staking on mainnet:

- Complete a focused staking review.
- Finalize and document TANDEM mint authority policy.
- Run staking-enabled local and devnet tests.
- Deploy a controlled upgrade that enables staking.
- Run mainnet staking tests with tiny amounts before public launch.

## Private Runbooks

Private deployment runbooks may include exact key paths, signer identities, authority addresses before announcement, RPC credentials, treasury setup details, and unresolved audit context. Keep those outside the public repo.
