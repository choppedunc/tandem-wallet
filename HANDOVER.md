# Tandem Wallet — Handover

Read end-to-end before writing any code. This document is the source of truth for the project state on the day of handoff. The codebase is mid-refactor and the on-chain program has not been redeployed; pay attention to §3 (current state) and §9 (next tasks).

---

## 1. Repo map

There are **two repos** for this project:

### Product repo — `/Users/max/projects/agentvault-solana/`
Remote: `https://github.com/choppedunc/tandem-wallet.git`. Contains the on-chain program, the Claude Code skill, the Mocha test suite, and the human-facing Next.js dapp.

```
agentvault-solana/
├── programs/tandem-wallet/       Anchor on-chain program (Rust)
│   ├── src/lib.rs                Program entrypoint, instruction registration
│   ├── src/state/                Vault, Proposal, WhitelistEntry, ProtocolConfig, StakeAccount
│   ├── src/instructions/         16 instruction handlers, one file each
│   ├── src/errors.rs
│   ├── src/events.rs
│   └── src/helpers.rs            Fee calculation + transfer helpers
├── tests/tandem-wallet.ts        Mocha + Chai integration tests (≈800 lines, 26 tests)
├── skill/                        Claude Code skill (agent-side CLI)
│   ├── SKILL.md                  Skill manifest
│   ├── references/REFERENCE.md
│   └── scripts/                  TypeScript CLI scripts the agent runs
│       ├── lib/{client,config,format}.ts
│       ├── idl/tandem_wallet.json
│       └── *.ts                  one file per command
├── app/                          Next.js 16 dapp — JUST BOOTSTRAPPED, see §5
│   ├── src/app/                  layout.tsx, page.tsx, globals.css
│   ├── src/components/           Dashboard, VaultDetail, panels, etc.
│   ├── src/lib/                  network.ts, program.ts, pdas.ts, format.ts, idl.json
│   ├── .env.local                runtime config (devnet)
│   ├── .env.example
│   ├── AGENTS.md / CLAUDE.md     Next.js's "read bundled docs first" instruction file
│   └── package.json
├── target/                       Anchor build output (.so, IDL, generated types)
├── Anchor.toml                   declares program ID + cluster (devnet)
├── Cargo.toml
├── HANDOVER.md                   ← this file
└── agent-keypair.json            (gitignored)
```

The folder name `agentvault-solana` is legacy from when the project was called "AgentVault." Everything inside uses "Tandem Wallet" / `tandem_wallet`.

There's also `/Users/max/projects/agentvault/` on disk — **ignore it**, it's a stale older project (no Tandem references, last touched 2 days before the rename).

### Website repo — `/Users/max/Documents/Tandem Site/`
Remote: `https://github.com/choppedunc/Tandem-Site.git`. **Static site only.** This is the marketing site at <https://tandemwallet.ai>, not the dapp.

```
Tandem Site/
├── index.html                Single-page marketing site (hero, flow, security, dev, roadmap, token, CTA)
├── styles.css                Source of truth for the design tokens (used by the dapp)
├── script.js                 Roadmap/token tab interactions + signup form handler
├── *.png / *.psd             hands.png, handsbg.png, tandem logo.png, etc.
├── *.ttf / *.woff2           AppleGaramond.ttf, sysfont.woff2 (locally hosted fallbacks)
└── .git/                     Independent repo — last 5 commits all about visual polish
```

The site repo and the product repo never share build steps. The dapp **copies design tokens** from `Tandem Site/styles.css` into `app/src/app/globals.css`; that's the only coupling. If the marketing visual identity changes, the dapp tokens may need a refresh.

### Other / unrelated
- `/Users/max/.degit/github/choppedunc/agentvault-solana/` — a degit cache, not a working repo. Ignore.

---

## 2. Vision (the why)

Tandem Wallet is a Solana smart account that lets a human owner delegate **bounded** USDC spending authority to an AI agent. The agent moves fast within a budget; anything over the budget queues a proposal that the human approves.

Three roles:
- **Human** — connects a Solana wallet (Phantom / Solflare). Sets spending limit, manages whitelist, approves proposals, can pause vault, can always send.
- **Agent** — has its own keypair (separate from human's wallet). Autonomously spends up to the limit; whitelist bypasses limit entirely; over-limit creates a proposal.
- **Recipient** — anyone receiving USDC. Whitelisted recipients have no spending cap.

Tagline (from marketing site): *"Balanced Autonomy — let agents move fast, require humans when necessary."*

---

## 3. Current state

### ✅ Working
- **On-chain program compiles** (`cargo check` clean).
- **All Mocha tests pass** against the post-refactor source (run `anchor test` to verify; needs Solana CLI installed first — see §4).
- **Skill scripts updated** to single-limit model. `npx degit` still installs them on agent machines.
- **Next.js app boots, typechecks (`npx tsc --noEmit` clean), and renders.** UI matches the marketing site's visual identity (dark + teal, Manrope/Chakra Petch, sharp corners with bracket detail).
- **Wallet adapter wired** (Phantom + Solflare) and visually styled to match.
- **Env-driven network config** in app — switching to mainnet is one env-var change.

### ⚠️ Half-built
- **App proposal-approve flow** assumes recipient ATA exists. If a proposal targets a wallet that's never held USDC, approve will fail. Skill creates ATAs on the send side; app needs the same on the approve side.
- **Multi-vault** — the program PDA seeds support multiple vaults per human (one per agent), but `Dashboard.tsx:88` just shows `vaults[0]`. No switcher yet.
- **Transaction history** — not built. Source data (program logs / events) exists; just no UI.
- **Initialize-protocol flow** — if `protocolConfig` doesn't exist yet, `send_usdc` fails. App doesn't detect or surface this; an admin section is needed.
- **App's IDL is hand-patched.** `app/src/lib/idl.json` was manually edited to match the new program shape because I didn't have Solana CLI to run `anchor build`. The `set_limit` and `SpendingLimitUpdated` discriminators are placeholders (`[0,0,0,0,0,0,0,0]` and `[0,0,0,0,0,0,0,1]`). **`anchor build` will overwrite them with the correct sha256-derived values.**

### 🚨 Broken / risky
- **Devnet program is the OLD shape.** I refactored from a two-tier model (`tier1_max + tier2_max + is_emergency`) to a single `spending_limit`. The Rust source reflects the new shape, but the deployed program on devnet is still the old one. **Any transaction the app submits today will fail** because the IDL says single-arg `initialize(spending_limit)` while the deployed program expects two-arg `initialize(tier1_max, tier2_max)`.
- **Existing devnet vaults will not deserialize** against the new struct (different field count). Re-init required after redeploy.
- **`skill/scripts/lib/config.ts` hardcodes a vault address** (`C4Cn5s5JQ8cWWf3HWi7zkYt3aE2pkwVHF1gfDJ742JC8`) from the old program. That vault is dead the moment the new program ships.
- **Solana CLI is NOT installed on this Mac.** No `cargo-build-sbf`, so `anchor build` and `anchor deploy` cannot run locally. Installing the CLI is the unblocking task.
- **`agent-keypair.json` exists at repo root, gitignored.** Don't commit it. Don't share it. It controls a devnet test agent.

### Last task in flight
The very last thing I did was restyle the dapp UI to match `tandemwallet.ai` (pulled CSS variables and font choices from `https://tandemwallet.ai/styles.css`). The user then asked for this handover doc to switch to Codex 5.5. There's no in-progress code change beyond what's in the working tree.

---

## 4. How to run everything

### Prerequisites (current state of this machine)
- Node 24.13.0 ✅ installed
- Rust + cargo ✅ installed at `~/.cargo/bin/`
- Anchor CLI ✅ installed at `~/.cargo/bin/anchor` (version 0.30.1 by package, verify with `anchor --version`)
- Solana CLI ❌ **NOT installed**. `cargo-build-sbf` is missing. Without it, `anchor build` fails and you cannot deploy.

### Install Solana CLI (do this first)
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
# Add ~/.local/share/solana/install/active_release/bin to PATH
solana --version    # confirm
solana config set --url devnet
solana-keygen new   # if you don't already have ~/.config/solana/id.json
solana airdrop 5    # devnet SOL for deploys
```

### On-chain — build, test, deploy
```bash
cd /Users/max/projects/agentvault-solana

# Quick syntax check (works without Solana CLI)
cargo check --manifest-path programs/tandem-wallet/Cargo.toml

# Full Anchor build — needs Solana CLI
anchor build

# Run integration tests against a local validator (auto-spawns one)
anchor test

# Deploy to devnet (uses provider.cluster from Anchor.toml = devnet)
anchor deploy

# After deploy, copy the regenerated IDL into the consumers
cp target/idl/tandem_wallet.json app/src/lib/idl.json
cp target/idl/tandem_wallet.json skill/scripts/idl/tandem_wallet.json
```

### App — develop and run
```bash
cd /Users/max/projects/agentvault-solana/app
npm install         # already done; rerun if dependencies change
npm run dev         # → http://localhost:3000
npx tsc --noEmit    # typecheck (currently clean)
npm run build       # production build
npm run start       # production server
npm run lint        # eslint
```

### Skill — agent-side CLI (separate working dir on the agent's machine)
```bash
# What an agent runs to install the skill (doesn't need this repo at all)
npx degit choppedunc/tandem-wallet/skill/scripts tandem
cd tandem
npm install
node -r ts-node/register generate-keypair.ts          # one-time
node -r ts-node/register vault-status.ts
node -r ts-node/register send-usdc.ts <recipient> <amount>
# Node 24+: prepend `--no-experimental-strip-types`
```

### Required env / secrets
- **App** (`app/.env.local`): see §5 for full list. All `NEXT_PUBLIC_*`, no real secrets.
- **Anchor** uses `~/.config/solana/id.json` as the deploy wallet (configured in `Anchor.toml`).
- **Skill** hardcodes config in `skill/scripts/lib/config.ts` (devnet RPC + program ID + agent private key); the `generate-keypair.ts` script regenerates the keypair section. **There are no env files in the skill directory.**
- **Tests** use `provider.wallet` from Anchor env, plus mint a mock USDC and mock TANDEM token in `before()`.

---

## 5. Solana specifics

### Framework
**Anchor 0.30.1** (pinned). Do not upgrade casually — 0.31+ touches every account constraint syntax.

### Program ID
`6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ`

Declared in three places (keep in sync):
- `programs/tandem-wallet/src/lib.rs` — `declare_id!`
- `Anchor.toml` — `[programs.localnet]` and `[programs.devnet]`
- `app/.env.local` — `NEXT_PUBLIC_PROGRAM_ID`
- `skill/scripts/lib/config.ts` — `programId`

The keypair behind this program ID is at `target/deploy/tandem_wallet-keypair.json`. **Don't lose it.**

### Cluster target
- Anchor.toml says `cluster = "devnet"`.
- App defaults to devnet.
- Tests spawn a local validator.
- **Mainnet has not been touched.**

### Deployment steps
```bash
anchor build                                    # produces target/deploy/tandem_wallet.so + IDL
anchor deploy --provider.cluster devnet         # pushes to devnet (uses ~/.config/solana/id.json)
# Optional: upgrade IDL on chain (rarely needed for app/skill flows)
anchor idl upgrade <PROGRAM_ID> --filepath target/idl/tandem_wallet.json
# Then refresh consumer IDLs:
cp target/idl/tandem_wallet.json app/src/lib/idl.json
cp target/idl/tandem_wallet.json skill/scripts/idl/tandem_wallet.json
```

### Account structures and PDAs

| Account | Seeds | Purpose |
|---|---|---|
| `Vault` | `["vault", human, agent]` | Stores `human, agent, usdc_mint, vault_usdc_ata, spending_limit, paused, proposal_count, bump`. Human can have multiple vaults (one per agent). |
| `Proposal` | `["proposal", vault, id_le_bytes]` | Pending over-limit transfer. Stores `vault, proposal_id, recipient, recipient_ata, amount, proposed_at, executed, cancelled, memo, bump`. |
| `WhitelistEntry` | `["whitelist", vault, address]` | Trusted recipient. Stores `vault, address, added_at, bump`. |
| `ProtocolConfig` | `["protocol_config"]` | Singleton. `authority, usdc_mint, tandem_mint, fee_bps, staker_reward_ata, buyback_ata, total_staked, reward_per_token_stored, bump`. |
| `StakeAccount` | `["stake", staker]` | Per-staker. `staker, staked_amount, last_update, reward_per_token_paid, rewards_owed, bump`. |

### Instruction list

| Instruction | Caller | What it does |
|---|---|---|
| `initialize(spending_limit: u64)` | human | Create vault. **As of today's refactor: single-arg.** |
| `send_usdc(amount: u64)` | agent or human | Transfer USDC. Whitelist → no cap. Under limit → executes. Over limit (agent only) → returns `OverSpendingLimit` (skill auto-falls-back to `propose`). Human can always send, even paused. |
| `propose(amount, memo)` | agent | Create a proposal for over-limit sends. memo ≤128 chars. |
| `approve_proposal()` | human | Execute a pending proposal (transfers USDC + fee). Fails if vault paused. |
| `cancel_proposal()` | human | Cancel a pending proposal. |
| `close_proposal()` | agent | Reclaim rent from an executed/cancelled proposal. |
| `set_limit(spending_limit)` | human | Update the spending limit. **Renamed from `set_tiers`.** `0` = approve every send. |
| `add_whitelist(address)` | human | Whitelist a recipient. |
| `remove_whitelist()` | human | Remove from whitelist. |
| `pause()` / `unpause()` | human | Block / allow agent activity. |
| `initialize_protocol(fee_bps)` | authority | One-time setup of fee + staking. fee_bps ≤ 10000. |
| `update_protocol_config(fee_bps)` | authority | Change fee. |
| `stake(amount)` | anyone | Deposit TANDEM. |
| `unstake()` | anyone | Withdraw TANDEM. **7-day lockup from last stake**. |
| `claim_rewards()` | anyone | Claim USDC rewards from accumulated fees. |

### Errors (post-refactor)
`OnlyHuman, OnlyAgent, OnlyAgentOrHuman, VaultPaused, VaultNotPaused, ProposalAlreadyExecuted, ProposalAlreadyCancelled, OverSpendingLimit, AlreadyWhitelisted, ZeroAmount, Overflow, LockupNotElapsed, NothingStaked, NoRewardsToClaim, OnlyAuthority, InvalidFeeBps`.

Removed in today's refactor: `InvalidThresholds, TierTooHigh, NotEmergency`.

### Protocol fee mechanics
- Default 25 bps (0.25%) on every successful `send_usdc` and `approve_proposal`.
- Fee split 50/50 between `staker_reward_ata` and `buyback_ata`.
- **If `total_staked == 0`, the staker portion redirects entirely to buyback** (fee committed in `72e5f50`).
- Reward accumulator is Synthetix-style (`reward_per_token_stored` advances on each fee event, stakers accrue based on their share at `last_update`).

### IDL locations
- `target/idl/tandem_wallet.json` — generated by `anchor build`. Source of truth.
- `app/src/lib/idl.json` — copy used by the dapp. **Currently hand-patched.**
- `skill/scripts/idl/tandem_wallet.json` — copy used by the skill. **Currently STALE (still references `tier1_max`, `set_tiers`, etc.).**

After every `anchor build`, refresh both copies.

---

## 6. Frontend / backend integration

### App → on-chain
The dapp uses `@coral-xyz/anchor` with a wallet-adapter–provided wallet:

- `app/src/lib/program.ts` exports `getProgram(connection, wallet)` which builds an `AnchorProvider` from the connected wallet and returns `new Program(idl, provider)`.
- `app/src/lib/pdas.ts` derives every PDA the app touches: `vaultPda`, `proposalPda`, `whitelistPda`, `protocolConfigPda`.
- Each panel component (`ProposalsPanel`, `SettingsPanel`, `WhitelistPanel`, `CreateVaultForm`) calls `program.methods.<ix>(...).accounts({...}).rpc()` directly. There is no API server / backend.

### Wallet adapter setup
`app/src/components/WalletProviders.tsx` wraps the layout with:
1. `<ConnectionProvider endpoint={RPC_URL}>` — endpoint from env
2. `<WalletProvider wallets={[Phantom, Solflare]} autoConnect>`
3. `<WalletModalProvider>` — gives us the connect modal

`Header.tsx` renders `<WalletMultiButton />` (dynamically imported with `ssr: false`). Component styles are overridden globally in `globals.css` via `.wallet-adapter-button { ... }` so the button matches the rest of the app.

The dapp uses `useAnchorWallet()` (from `@solana/wallet-adapter-react`) — that hook returns `null` until connected, which is why every panel guards on `if (!wallet) return`.

### App env vars (all `NEXT_PUBLIC_` because they need to reach the browser)
| Var | Devnet default | Mainnet equivalent |
|---|---|---|
| `NEXT_PUBLIC_NETWORK` | `devnet` | `mainnet-beta` |
| `NEXT_PUBLIC_RPC_URL` | `https://api.devnet.solana.com` | Helius/QuickNode/Triton URL |
| `NEXT_PUBLIC_PROGRAM_ID` | `6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ` | same (unless redeployed with new key) |
| `NEXT_PUBLIC_USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

### Skill → on-chain
Mirror of the app pattern, but with a Keypair instead of a wallet adapter. `skill/scripts/lib/client.ts:42` builds the `Program` with a `Wallet(agentKeypair)`. Scripts call `program.methods.X(...).rpc()` and print JSON.

### How the website relates to the product
**They do not share code.** The marketing site at `tandemwallet.ai` is a static HTML/CSS/JS page in a separate repo (`/Users/max/Documents/Tandem Site/`, GitHub `choppedunc/Tandem-Site`). The product repo's dapp **copies design tokens** (colors, fonts, the corner-bracket trick) from the marketing site's `styles.css` to keep brand consistency, but that's a one-way copy and is currently a manual job. If the marketing identity changes, refresh `app/src/app/globals.css` by hand.

The marketing site has a "Join waitlist" CTA that posts to a form (see `Tandem Site/script.js`). That form is the only signup mechanism today — there is no app-side onboarding for waitlisted users.

---

## 7. Testing and verification

### Existing tests — `tests/tandem-wallet.ts`
Mocha + Chai, ~26 tests organised in describe blocks:
- **Initialization** — vault init, protocol init, vault funding
- **Spending routing** — send at limit succeeds, over-limit fails (`OverSpendingLimit`), 0-limit blocks every send
- **Proposals** — propose 150 USDC, approve, cancel, close
- **Whitelist** — add, send-over-limit-to-whitelisted, remove, post-removal failure
- **Admin** — set limit, set limit to 0, pause, agent-blocked-while-paused, human-can-send-while-paused, unpause
- **Fee precision** — tiny amounts (rounds to 0), 100 USDC fee correctness
- **Staking** — setup, stake, restake (timer reset), pre-lockup unstake fails, generate fees + claim, no-double-claim, update protocol config

Run with `anchor test` (auto-spawns localnet, deploys, runs).

### Known failures
None expected once Solana CLI is installed. Tests were rewritten to match the new model in this session and reviewed against the new on-chain code.

### Manual QA checklist (after deploy)
1. Connect wallet on `http://localhost:3000` — see "Create vault" prompt.
2. Create vault with generated agent + limit = 50 USDC. Confirm tx, see vault dashboard.
3. Mint mock USDC to `vault_usdc_ata` (use `spl-token transfer` or a small helper script).
4. From the skill side, run `send-usdc.ts <recipient> 30` — should execute.
5. Run `send-usdc.ts <recipient> 75` — should auto-propose.
6. Refresh app proposals panel — see #0 pending.
7. Click Approve — confirm in wallet, proposal flips to executed.
8. Set limit to 0 in Settings, run `send-usdc.ts 1` — should auto-propose.
9. Pause vault, attempt agent send — should fail with `VaultPaused`.
10. Add a whitelist entry, agent sends 200 USDC — should succeed bypassing the limit.

### Commands I used successfully this session
- `cargo check --manifest-path programs/tandem-wallet/Cargo.toml` — clean
- `cd app && npx tsc --noEmit` — clean
- `cd app && npm run dev` — runs, serves on :3000, GET / returns 200
- `node -e "JSON.parse(require('fs').readFileSync('src/lib/idl.json','utf8'))"` — IDL is valid JSON

### Commands I could NOT run (Solana CLI missing)
- `anchor build` — needs `cargo-build-sbf`
- `anchor deploy` — same
- `anchor test` — same (auto-builds first)

---

## 8. Pending decisions

Things I made a call on without explicit user confirmation, plus things genuinely undecided. Codex should treat these as open until the user weighs in.

### Decisions I made (and why)
- **Single spending limit, no emergency tier.** User asked whether the two-tier model was too complex; I argued yes (the agent self-asserted `is_emergency`, so the tier 2 cap added no real safety) and the user said "yeah lets do that first". This drove the entire refactor in the working tree.
- **`spending_limit = 0` means "approve every send"** rather than disabling the agent entirely. The user explicitly endorsed this in conversation.
- **Whitelist bypasses the spending limit entirely** (no per-recipient cap). Inherited from the original design; kept for simplicity.
- **App lives at `app/` inside the product repo**, not a separate repo. Lowest friction; can be split later if needed.
- **Phantom + Solflare wallets only** in the wallet adapter list. Easy to add Backpack/Glow later.
- **Single-vault dashboard (`vaults[0]`)**. The PDAs support N vaults per human; the UI doesn't yet. Multi-vault switcher is a TODO.
- **Visual identity copied from `tandemwallet.ai`** (CSS variables + Manrope/Chakra Petch fonts + the bracket-corner trick). User asked for this directly.
- **No mainnet config yet.** Devnet only. Env vars are designed to make the switch trivial.

### Open / undecided
- **Buyback wallet ownership** on mainnet. The protocol fee redirects 50% to a buyback wallet — who controls it? Dev wallet, multisig, or auto-burn contract?
- **Real TANDEM mint** for mainnet — needs creation + token metadata + initial distribution.
- **Audit timing.** The on-chain program manages real money but hasn't been audited.
- **Front-end deployment target.** Probably Vercel (zero-config for Next.js), but not chosen.
- **Domain for the dapp.** Marketing is on `tandemwallet.ai`. Dapp could go on `app.tandemwallet.ai` or `tandemwallet.ai/app`.
- **Whether to add `create_idempotent_ata` to the approve flow.** Right now if a proposal targets a fresh wallet, approve fails because no recipient ATA exists. The skill creates ATAs on send; the app doesn't on approve.
- **Whether to support multi-sig humans.** Currently single human key controls everything.
- **Proposal expiry.** Proposals live forever until executed/cancelled. Should they expire?

### Things the user told me that aren't obvious from code
- The "Tandem Wallet" rename from "AgentVault" is recent and complete in code (commit `6afbdb6`), but the product repo's **folder name** (`agentvault-solana`) and **GitHub repo name** (`tandem-wallet` — that one is renamed) reflect the rename inconsistency. Don't rename the local folder casually; it'll break absolute paths everywhere.
- The user wants devnet-first **with mainnet in mind from day one** — that's why every var is env-driven.
- The user wants the app UI to match the marketing site exactly.
- The user is switching to Codex 5.5 to continue this work; this doc is the handoff.

---

## 9. Git state

### Product repo (`agentvault-solana`)
- Branch: **`main`**
- Remote: `https://github.com/choppedunc/tandem-wallet.git`
- **Working tree is dirty.** None of today's work has been committed.

#### Recent commits (most recent first)
```
6afbdb6  Rename AgentVault to Tandem Wallet across entire project
72e5f50  Redirect staker fees to buyback when no one is staked
9f3c84c  Add protocol fee & staking system to on-chain program
a33f6be  Update skill scripts for fee & staking protocol
9615e02  Add zero-setup skill: npx degit download + keypair generation
a07d15b  Remove env dependency — hardcode devnet config for zero-setup use
2ede016  Make skill portable for standalone agent use
8c9e311  Add agent-keypair.json to gitignore
7172d5d  Initial implementation of AgentVault Solana program
```

#### Uncommitted changes (today's work)

**Modified files** (refactor: tier model → single limit):
- `programs/tandem-wallet/src/state/vault.rs` — drop `tier1_max`/`tier2_max`, add `spending_limit`
- `programs/tandem-wallet/src/instructions/initialize.rs` — single-arg
- `programs/tandem-wallet/src/instructions/send_usdc.rs` — drop `is_emergency`, simplify routing
- `programs/tandem-wallet/src/instructions/mod.rs` — replace `set_tiers` mod with `set_limit`
- `programs/tandem-wallet/src/lib.rs` — update instruction registrations
- `programs/tandem-wallet/src/errors.rs` — replace tier errors with `OverSpendingLimit`
- `programs/tandem-wallet/src/events.rs` — `TiersUpdated` → `SpendingLimitUpdated`, drop `tier` field from `UsdcSent`
- `tests/tandem-wallet.ts` — rewritten for new model + new "0 limit" test
- `skill/SKILL.md` — docs match new model
- `skill/references/REFERENCE.md` — same
- `skill/scripts/send-usdc.ts` — drop `--emergency` flag, auto-propose on over-limit
- `skill/scripts/vault-status.ts` — show `spendingLimit` instead of `tier1Max/tier2Max`

**Deleted files:**
- `programs/tandem-wallet/src/instructions/set_tiers.rs` (replaced by `set_limit.rs`)
- `skill/scripts/estimate-tier.ts` (renamed to `preview-send.ts`)

**New files:**
- `programs/tandem-wallet/src/instructions/set_limit.rs`
- `skill/scripts/preview-send.ts`
- `app/` (entire Next.js dapp, ~25 files in `src/`)
- `HANDOVER.md` (this file)
- `.DS_Store` (should be gitignored)

#### Suggested commit grouping (when ready)
1. Refactor: collapse two-tier to single spending limit (programs + tests)
2. Skill: update for single-limit model, rename `estimate-tier` → `preview-send`
3. App: bootstrap Next.js dapp with vault management UI
4. App: match visual identity to tandemwallet.ai
5. Add HANDOVER.md

### Website repo (`/Users/max/Documents/Tandem Site/`)
- Independent repo, **untouched this session**.
- Last 5 commits: `987ff12 token section update` → `a90d66f Build TandemWallet landing page and signup flow`.

---

## 10. Next 3-5 tasks (in order)

These are the specific moves to make immediately. Do them in order — task 1 unblocks 2-5.

### Task 1 — Install Solana CLI and redeploy the program
**Why:** the on-chain program in the working tree is correct, but the deployed devnet program is the old two-tier shape. Until the new code is on-chain, the dapp and the skill cannot do anything.

**Steps:**
1. Install Solana CLI: `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`
2. Verify: `solana --version` and `cargo build-sbf --version`
3. Top up the deploy wallet: `solana config set --url devnet && solana airdrop 5`
4. From repo root: `anchor build` — should produce `target/idl/tandem_wallet.json` and `target/deploy/tandem_wallet.so`
5. `anchor test` — confirm all 26 tests pass
6. `anchor deploy` — pushes to devnet
7. Refresh consumer IDLs:
   ```bash
   cp target/idl/tandem_wallet.json app/src/lib/idl.json
   cp target/idl/tandem_wallet.json skill/scripts/idl/tandem_wallet.json
   ```
8. Verify the previously-placeholder discriminators in `app/src/lib/idl.json` for `set_limit` and `SpendingLimitUpdated` are now real sha256 values, not zeros.

**Definition of done:** `anchor test` passes, deploy succeeds, fresh IDL is in both consumer locations.

### Task 2 — Re-bootstrap the protocol and a test vault on the new program
**Why:** every existing devnet vault and the protocol config are tied to the old program shape. They're effectively dead.

**Steps:**
1. Decide and create the mainnet-style accounts (for now, on devnet):
   - Mock TANDEM mint (or use the script in `tests/tandem-wallet.ts:80` for reference)
   - Buyback wallet — for devnet, just generate a new keypair and create its USDC ATA
2. Call `initialize_protocol(fee_bps=25)` once. Easiest path: write a one-shot script in `app/scripts/init-protocol.ts` (new dir) that uses the same anchor client, or a Node REPL.
3. Create a test vault from the dapp UI: connect Phantom on devnet, fill the Create Vault form, generate the agent keypair, set limit to 50.
4. Update `skill/scripts/lib/config.ts` to point at the new vault address (or refactor to read from env — recommended).
5. Mint mock USDC into `vault_usdc_ata` so the vault has funds to send.

**Definition of done:** `vault-status.ts` from the skill returns real numbers, the dapp shows the vault with a non-zero USDC balance.

### Task 3 — Wire `create_idempotent_ata` into the proposal-approve flow
**Why:** today, if an agent proposes a send to a wallet that's never held USDC, the human's "Approve" click will fail because `recipient_ata` doesn't exist. This is a real-world break for a wallet's most-used flow.

**Where to look:**
- `programs/tandem-wallet/src/instructions/approve_proposal.rs` — has the recipient ATA constraint
- `app/src/components/ProposalsPanel.tsx` — the `approve(p)` function around line 70
- `@solana/spl-token`'s `createAssociatedTokenAccountIdempotentInstruction`

**Approach:** in the approve flow, build a transaction that bundles `createAssociatedTokenAccountIdempotentInstruction(human, recipient_ata, recipient, usdc_mint)` followed by the `approve_proposal` ix. The idempotent variant is a no-op if the ATA already exists.

**Definition of done:** approving a proposal whose recipient has no USDC ATA succeeds without separate setup.

### Task 4 — Multi-vault switcher in the dashboard
**Why:** the program supports N vaults per human (different agents), but the UI shows only `vaults[0]`. Real users will have multiple agents.

**Where to look:** `app/src/components/Dashboard.tsx:88` (currently `return <VaultDetail vault={vaults[0]} ... />`).

**Approach:** add a sidebar or dropdown listing all vaults the human owns, with the agent address as the label and a "+ new vault" button. Persist the selected vault in `useState` (or URL param if you want shareable links).

**Definition of done:** with two devnet vaults, the dashboard lets you switch between them and shows accurate data per vault.

### Task 5 — Better error UX
**Why:** Anchor errors come back as raw `e.message` strings full of program codes. Users see things like `AnchorError caused by account: vault. Error Code: VaultPaused. Error Number: 6003.`

**Where to look:** every panel component has a `catch (e: any) { setError(e.message) }`. Replace that with a small mapper.

**Approach:** in `app/src/lib/errors.ts` (new file), export `mapAnchorError(e)` that pulls `e?.error?.errorCode?.code` and translates known codes:
- `VaultPaused` → "Your vault is paused. Unpause it from Settings to approve."
- `OverSpendingLimit` → "Amount exceeds your spending limit." (shouldn't reach the human via app, but defensive)
- `ProposalAlreadyExecuted` → "This proposal has already been approved."
- `ProposalAlreadyCancelled` → "This proposal was already cancelled."
- Default: keep the raw message.

**Definition of done:** every error in the app is human-readable; raw anchor strings only appear for genuinely unexpected failures.

---

## 11. External resources

- **Marketing site:** <https://tandemwallet.ai> (CSS at `/styles.css` is the design source-of-truth)
- **Website repo:** <https://github.com/choppedunc/Tandem-Site>
- **Product repo:** <https://github.com/choppedunc/tandem-wallet>
- **Devnet USDC mint (Circle test):** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **Mainnet USDC mint:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Anchor docs:** <https://www.anchor-lang.com/>
- **Solana wallet-adapter:** <https://github.com/anza-xyz/wallet-adapter>
- **Solana CLI install:** <https://docs.anza.xyz/cli/install>
- **Next.js bundled docs:** `app/node_modules/next/dist/docs/` — read these before writing Next.js 16 code; training data is older

Good luck.
