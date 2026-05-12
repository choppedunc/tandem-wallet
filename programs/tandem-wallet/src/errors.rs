use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Only the human signer can perform this action")]
    OnlyHuman,
    #[msg("Only the agent signer can perform this action")]
    OnlyAgent,
    #[msg("Only the agent or human signer can perform this action")]
    OnlyAgentOrHuman,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    VaultNotPaused,
    #[msg("Proposal has already been executed")]
    ProposalAlreadyExecuted,
    #[msg("Proposal has already been cancelled")]
    ProposalAlreadyCancelled,
    #[msg("Amount exceeds spending limit, must use propose")]
    OverSpendingLimit,
    #[msg("Address is already whitelisted")]
    AlreadyWhitelisted,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("7-day lockup has not elapsed")]
    LockupNotElapsed,
    #[msg("Nothing staked")]
    NothingStaked,
    #[msg("No rewards to claim")]
    NoRewardsToClaim,
    #[msg("Only the protocol authority can perform this action")]
    OnlyAuthority,
    #[msg("Fee basis points must be <= 10000")]
    InvalidFeeBps,
    #[msg("Vault mint must match the protocol USDC mint")]
    InvalidUsdcMint,
    #[msg("Recipient token account must be the recipient's associated USDC token account")]
    InvalidRecipientAta,
    #[msg("Staker reward token account must be the configured USDC reward account")]
    InvalidStakerRewardAta,
    #[msg("Treasury token account must be the treasury wallet's associated USDC token account")]
    InvalidTreasuryAta,
    #[msg("Vault token account must be the vault's associated USDC token account")]
    InvalidVaultAta,
    #[msg("New authority must not be the default public key")]
    InvalidAuthority,
    #[msg("Proposal must be executed or cancelled before it can be closed")]
    ProposalStillPending,
    #[msg("Staker TANDEM token account must match the staker and protocol TANDEM mint")]
    InvalidStakerTandemAta,
    #[msg("TANDEM mint must match the protocol TANDEM mint")]
    InvalidTandemMint,
    #[msg("Staking is not enabled for this deployment")]
    StakingDisabled,
}
