use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// The human owner who controls this vault.
    pub human: Pubkey,
    /// The AI agent authorized to propose withdrawals.
    pub agent: Pubkey,
    /// The USDC mint address.
    pub usdc_mint: Pubkey,
    /// The vault's associated token account for USDC.
    pub vault_usdc_ata: Pubkey,
    /// Maximum amount (in USDC minor units) the agent can send per tx without human approval.
    /// Anything above this requires a proposal. Setting this to 0 means every send requires approval.
    pub spending_limit: u64,
    /// Whether the vault is paused (blocks new proposals).
    pub paused: bool,
    /// Running count of proposals created against this vault.
    pub proposal_count: u64,
    /// PDA bump seed.
    pub bump: u8,
}

impl Vault {
    pub const SEED_PREFIX: &'static [u8] = b"vault";
}
