use crate::errors::*;
use crate::events::*;
use crate::helpers;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
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

    /// Staker's TANDEM token account
    #[account(
        mut,
        constraint = staker_tandem_ata.mint == protocol_config.tandem_mint
            @ VaultError::InvalidStakerTandemAta,
        constraint = staker_tandem_ata.owner == staker.key()
            @ VaultError::InvalidStakerTandemAta,
    )]
    pub staker_tandem_ata: Account<'info, TokenAccount>,

    /// Protocol's TANDEM ATA where staked tokens are held
    #[account(
        mut,
        associated_token::mint = tandem_mint,
        associated_token::authority = protocol_config,
    )]
    pub stake_tandem_ata: Account<'info, TokenAccount>,

    /// Staker reward USDC ATA (for balance check in update_rewards)
    #[account(
        constraint = staker_reward_ata.key() == protocol_config.staker_reward_ata
            @ VaultError::InvalidStakerRewardAta,
        constraint = staker_reward_ata.mint == protocol_config.usdc_mint
            @ VaultError::InvalidStakerRewardAta,
    )]
    pub staker_reward_ata: Account<'info, TokenAccount>,

    #[account(
        constraint = tandem_mint.key() == protocol_config.tandem_mint
            @ VaultError::InvalidTandemMint,
    )]
    pub tandem_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<Unstake>) -> Result<()> {
    helpers::require_staking_enabled()?;

    let stake_account = &ctx.accounts.stake_account;
    require!(stake_account.staked_amount > 0, VaultError::NothingStaked);

    // Check 7-day lockup
    let now = Clock::get()?.unix_timestamp;
    let unlock_ts = stake_account
        .last_stake_ts
        .checked_add(StakeAccount::LOCKUP_SECONDS)
        .ok_or(VaultError::Overflow)?;
    require!(now >= unlock_ts, VaultError::LockupNotElapsed);

    let unstake_amount = stake_account.staked_amount;
    let reward_balance = ctx.accounts.staker_reward_ata.amount;
    let config_bump = ctx.accounts.protocol_config.bump;

    // Grab account infos before mutable borrow
    let config_info = ctx.accounts.protocol_config.to_account_info();
    let token_info = ctx.accounts.token_program.to_account_info();
    let from_info = ctx.accounts.stake_tandem_ata.to_account_info();
    let to_info = ctx.accounts.staker_tandem_ata.to_account_info();

    let config = &mut ctx.accounts.protocol_config;
    let stake_account = &mut ctx.accounts.stake_account;

    // Lazy reward update before state change
    helpers::update_rewards(config, Some(stake_account), reward_balance)?;

    // Transfer all TANDEM back to staker using PDA signer
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
    token::transfer(cpi_ctx, unstake_amount)?;

    // Update state
    stake_account.staked_amount = 0;
    config.total_staked = config
        .total_staked
        .checked_sub(unstake_amount)
        .ok_or(VaultError::Overflow)?;

    emit!(Unstaked {
        staker: ctx.accounts.staker.key(),
        amount: unstake_amount,
        total_staked: config.total_staked,
    });

    Ok(())
}
