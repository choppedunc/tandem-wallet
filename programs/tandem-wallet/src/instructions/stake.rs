use crate::errors::*;
use crate::events::*;
use crate::helpers;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::TokenAccount;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount as InterfaceTokenAccount, TokenInterface, TransferChecked,
};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + StakeAccount::INIT_SPACE,
        seeds = [StakeAccount::SEED_PREFIX, staker.key().as_ref()],
        bump,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    /// Staker's TANDEM token account
    #[account(
        mut,
        constraint = staker_tandem_ata.mint == protocol_config.tandem_mint
            @ VaultError::InvalidStakerTandemAta,
        constraint = staker_tandem_ata.owner == staker.key()
            @ VaultError::InvalidStakerTandemAta,
    )]
    pub staker_tandem_ata: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,

    /// Protocol's TANDEM ATA where staked tokens are held
    #[account(
        mut,
        associated_token::mint = tandem_mint,
        associated_token::authority = protocol_config,
        associated_token::token_program = tandem_token_program,
    )]
    pub stake_tandem_ata: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,

    /// Staker reward USDC ATA (for balance check in update_rewards)
    #[account(
        constraint = staker_reward_ata.key() == protocol_config.staker_reward_ata
            @ VaultError::InvalidStakerRewardAta,
        constraint = staker_reward_ata.mint == protocol_config.usdc_mint
            @ VaultError::InvalidStakerRewardAta,
    )]
    pub staker_reward_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        constraint = tandem_mint.key() == protocol_config.tandem_mint
            @ VaultError::InvalidTandemMint,
    )]
    pub tandem_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub tandem_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    helpers::require_staking_enabled()?;

    require!(amount > 0, VaultError::ZeroAmount);

    let config = &mut ctx.accounts.protocol_config;
    let stake_account = &mut ctx.accounts.stake_account;
    let reward_balance = ctx.accounts.staker_reward_ata.amount;

    // Lazy reward update before state change
    helpers::update_rewards(config, Some(stake_account), reward_balance)?;

    // Transfer TANDEM from staker to protocol
    let cpi_ctx = CpiContext::new(
        ctx.accounts.tandem_token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.staker_tandem_ata.to_account_info(),
            mint: ctx.accounts.tandem_mint.to_account_info(),
            to: ctx.accounts.stake_tandem_ata.to_account_info(),
            authority: ctx.accounts.staker.to_account_info(),
        },
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.tandem_mint.decimals)?;

    // Update stake state
    stake_account.staker = ctx.accounts.staker.key();
    stake_account.staked_amount = stake_account
        .staked_amount
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;
    stake_account.last_stake_ts = Clock::get()?.unix_timestamp;
    stake_account.bump = ctx.bumps.stake_account;

    config.total_staked = config
        .total_staked
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;

    emit!(Staked {
        staker: ctx.accounts.staker.key(),
        amount,
        total_staked: config.total_staked,
    });

    Ok(())
}
