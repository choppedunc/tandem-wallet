use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub fee_bps: u16,                  // 25 = 0.25%
    pub usdc_mint: Pubkey,
    pub tandem_mint: Pubkey,
    pub staker_reward_ata: Pubkey,     // USDC ATA owned by this PDA
    pub treasury_ata: Pubkey,           // USDC ATA for treasury wallet
    pub reward_per_token_stored: u128, // Synthetix accumulator (scaled by 1e12)
    pub total_staked: u64,             // total TANDEM currently staked
    pub total_rewards_claimed: u64,    // cumulative USDC claimed by all stakers
    pub total_rewards_processed: u64,  // cumulative USDC accounted into reward_per_token
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SEED_PREFIX: &'static [u8] = b"protocol_config";
}
