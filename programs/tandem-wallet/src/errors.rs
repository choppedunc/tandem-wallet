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
}
