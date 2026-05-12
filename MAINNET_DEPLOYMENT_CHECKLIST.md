# Tandem Wallet Mainnet Deployment Checklist

This checklist is for the vault-first launch. Staking is intentionally disabled in the default program build.

## Non-Negotiables

- Do not paste mainnet private keys into chat, docs, screenshots, tickets, or GitHub.
- Do not store deployer, authority, treasury, or mint keypairs inside this repo.
- Use fresh mainnet identities. Do not reuse devnet/test wallets for mainnet authority roles.
- Use multisig or hardware-backed wallets for long-term authorities.
- Deploy from a tagged, tested commit.

## Required Mainnet Addresses

Fill these in before launch:

- Mainnet USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Program ID: `TODO`
- Program keypair path, local only: `TODO`
- Temporary deployer public key: `TODO`
- Program upgrade authority multisig: `TODO`
- Tandem protocol authority multisig: `TODO`
- Treasury owner wallet or multisig: `TODO`
- Treasury USDC ATA: `TODO`
- TANDEM mint: `TODO`
- TANDEM mint authority policy: `TODO`
- Mainnet RPC URL: `TODO`

## Pre-Deploy Checks

- Confirm `git status` has no unexpected tracked changes.
- Confirm audit notes and local keypair files are not staged.
- Run `npm run check:secrets`.
- Run app and program checks:
  - `cargo test --workspace`
  - `npm run lint`
  - `npm run build`
  - `cargo build-sbf --manifest-path programs/tandem-wallet/Cargo.toml --sbf-out-dir target/deploy`
  - `anchor test --skip-build --provider.cluster localnet`
- Run staking test build separately, not for mainnet deploy:
  - `cargo build-sbf --manifest-path programs/tandem-wallet/Cargo.toml --sbf-out-dir target/deploy --features staking-enabled`
  - `STAKING_ENABLED=true anchor test --skip-build --provider.cluster localnet`
  - `cargo build-sbf --manifest-path programs/tandem-wallet/Cargo.toml --sbf-out-dir target/deploy`

## Mainnet Build Rule

For the vault-first launch, build without the staking feature:

```sh
cargo build-sbf --manifest-path programs/tandem-wallet/Cargo.toml --sbf-out-dir target/deploy
```

Do not use `--features staking-enabled` for the mainnet vault launch.

## Initialization Rules

Use explicit mainnet environment values. The init script requires `MAINNET_DEPLOY=true`, `TREASURY_OWNER` or `TREASURY_WALLET`, and `TANDEM_MINT` for mainnet.

Required environment:

```sh
MAINNET_DEPLOY=true
NEXT_PUBLIC_RPC_URL=<mainnet_rpc_url>
NEXT_PUBLIC_PROGRAM_ID=<mainnet_program_id>
NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
ANCHOR_WALLET=<local_deployer_keypair_path>
TREASURY_OWNER=<treasury_owner_or_multisig_pubkey>
TANDEM_MINT=<final_tandem_mint_pubkey>
PROTOCOL_FEE_BPS=25
```

## Post-Deploy Authority Moves

Immediately after deploy and initialization:

- Transfer program upgrade authority to the upgrade authority multisig.
- Transfer Tandem protocol authority to the protocol authority multisig.
- Confirm both authority changes on a block explorer and via CLI.
- Leave the temporary deployer wallet with minimal or zero funds after launch.

## Smoke Tests With Real Funds

Use tiny amounts first:

- Create one vault.
- Deposit a small amount of SOL for rent/fees.
- Deposit a small amount of mainnet USDC.
- Execute one transaction within allowance.
- Submit one over-allowance proposal and approve it.
- Submit one over-allowance proposal and reject it.
- Test whitelist behavior.
- Test paused vault behavior.
- Test human USDC withdrawal with `MAX`.
- Confirm history, balances, proposal notifications, and explorer links in the web app.

## Staking Later

Staking calls are blocked in the default build by `StakingDisabled`.

Before enabling staking on mainnet:

- Complete focused staking audit.
- Finalize TANDEM mint authority policy.
- Run staking-enabled local and devnet tests.
- Deploy a controlled upgrade that enables staking.
- Run mainnet staking tests with tiny amounts before public launch.
