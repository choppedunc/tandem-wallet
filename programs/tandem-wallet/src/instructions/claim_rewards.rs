use crate::errors::*;
use crate::events::*;
use crate::helpers;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [StakeAccount::SEED_PREFIX, staker.key().as_ref()],
        bump = stake_account.bump,
        constraint = stake_account.staker == staker.key(),
    )]
    pub stake_account: Account<'info, StakeAccount>,

    /// Protocol's USDC reward ATA (source of reward payouts)
    #[account(
        mut,
        constraint = staker_reward_ata.key() == protocol_config.staker_reward_ata
            @ VaultError::InvalidStakerRewardAta,
        constraint = staker_reward_ata.mint == protocol_config.usdc_mint
            @ VaultError::InvalidStakerRewardAta,
    )]
    pub staker_reward_ata: Account<'info, TokenAccount>,

    /// Staker's personal USDC ATA (destination for claimed rewards)
    #[account(
        mut,
        constraint = staker_usdc_ata.mint == protocol_config.usdc_mint
            @ VaultError::InvalidRecipientAta,
        constraint = staker_usdc_ata.owner == staker.key()
            @ VaultError::InvalidRecipientAta,
        constraint = staker_usdc_ata.key()
            == get_associated_token_address(&staker.key(), &protocol_config.usdc_mint)
            @ VaultError::InvalidRecipientAta,
    )]
    pub staker_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimRewards>) -> Result<()> {
    let reward_balance = ctx.accounts.staker_reward_ata.amount;
    let config_bump = ctx.accounts.protocol_config.bump;

    // Grab account infos before mutable borrow
    let config_info = ctx.accounts.protocol_config.to_account_info();
    let token_info = ctx.accounts.token_program.to_account_info();
    let from_info = ctx.accounts.staker_reward_ata.to_account_info();
    let to_info = ctx.accounts.staker_usdc_ata.to_account_info();

    let config = &mut ctx.accounts.protocol_config;
    let stake_account = &mut ctx.accounts.stake_account;

    // Lazy reward update
    helpers::update_rewards(config, Some(stake_account), reward_balance)?;

    let rewards = stake_account.rewards_owed;
    require!(rewards > 0, VaultError::NoRewardsToClaim);

    // Transfer USDC rewards from protocol reward ATA to staker
    let seeds = &[ProtocolConfig::SEED_PREFIX, &[config_bump]];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        token_info,
        Transfer {
            from: from_info,
            to: to_info,
            authority: config_info,
        },
        signer_seeds,
    );
    token::transfer(cpi_ctx, rewards)?;

    // Update accounting
    stake_account.rewards_owed = 0;
    config.total_rewards_claimed = config
        .total_rewards_claimed
        .checked_add(rewards)
        .ok_or(VaultError::Overflow)?;

    emit!(RewardsClaimed {
        staker: ctx.accounts.staker.key(),
        amount: rewards,
    });

    Ok(())
}
