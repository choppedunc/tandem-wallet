use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub staker: Pubkey,
    pub staked_amount: u64,
    pub reward_per_token_paid: u128, // user's snapshot of reward_per_token
    pub rewards_owed: u64,           // accumulated unclaimed USDC
    pub last_stake_ts: i64,          // for 7-day lock (resets on every stake)
    pub bump: u8,
}

impl StakeAccount {
    pub const SEED_PREFIX: &'static [u8] = b"stake";
    pub const LOCKUP_SECONDS: i64 = 7 * 24 * 60 * 60; // 7 days
}
