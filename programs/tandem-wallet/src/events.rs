use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub human: Pubkey,
    pub agent: Pubkey,
    pub usdc_mint: Pubkey,
}

#[event]
pub struct UsdcSent {
    pub vault: Pubkey,
    pub signer: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub whitelisted: bool,
}

#[event]
pub struct ProposalCreated {
    pub vault: Pubkey,
    pub proposal_id: u64,
    pub recipient: Pubkey,
    pub amount: u64,
    pub memo: String,
}

#[event]
pub struct ProposalApproved {
    pub vault: Pubkey,
    pub proposal_id: u64,
    pub recipient: Pubkey,
    pub amount: u64,
    pub fee: u64,
}

#[event]
pub struct ProposalCancelled {
    pub vault: Pubkey,
    pub proposal_id: u64,
}

#[event]
pub struct SpendingLimitUpdated {
    pub vault: Pubkey,
    pub spending_limit: u64,
}

#[event]
pub struct WhitelistAdded {
    pub vault: Pubkey,
    pub address: Pubkey,
}

#[event]
pub struct WhitelistRemoved {
    pub vault: Pubkey,
    pub address: Pubkey,
}

#[event]
pub struct VaultPausedEvent {
    pub vault: Pubkey,
}

#[event]
pub struct VaultUnpausedEvent {
    pub vault: Pubkey,
}

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub usdc_mint: Pubkey,
    pub tandem_mint: Pubkey,
}

#[event]
pub struct Staked {
    pub staker: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
}

#[event]
pub struct Unstaked {
    pub staker: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
}

#[event]
pub struct RewardsClaimed {
    pub staker: Pubkey,
    pub amount: u64,
}
