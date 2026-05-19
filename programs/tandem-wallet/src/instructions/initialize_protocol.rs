use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::token_interface::{
    Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount, TokenInterface,
};

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump,
    )]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,

    pub usdc_mint: Box<Account<'info, Mint>>,
    pub tandem_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    /// USDC ATA owned by the protocol_config PDA — staker rewards accumulate here
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = protocol_config,
    )]
    pub staker_reward_ata: Box<Account<'info, TokenAccount>>,

    /// USDC ATA for treasury wallet
    #[account(
        constraint = treasury_ata.mint == usdc_mint.key() @ VaultError::InvalidTreasuryAta,
        constraint = treasury_ata.key() != staker_reward_ata.key() @ VaultError::InvalidTreasuryAta,
        constraint = treasury_ata.key()
            == get_associated_token_address(&treasury_ata.owner, &usdc_mint.key())
            @ VaultError::InvalidTreasuryAta,
    )]
    pub treasury_ata: Box<Account<'info, TokenAccount>>,

    /// TANDEM ATA owned by the protocol_config PDA — staked tokens held here
    #[account(
        init,
        payer = authority,
        associated_token::mint = tandem_mint,
        associated_token::authority = protocol_config,
        associated_token::token_program = tandem_token_program,
    )]
    pub stake_tandem_ata: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ VaultError::OnlyAuthority,
    )]
    pub program: Program<'info, crate::program::TandemWallet>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key()) @ VaultError::OnlyAuthority,
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub tandem_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeProtocol>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= 10_000, VaultError::InvalidFeeBps);

    let config = &mut ctx.accounts.protocol_config;
    config.authority = ctx.accounts.authority.key();
    config.fee_bps = fee_bps;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.tandem_mint = ctx.accounts.tandem_mint.key();
    config.staker_reward_ata = ctx.accounts.staker_reward_ata.key();
    config.treasury_ata = ctx.accounts.treasury_ata.key();
    config.reward_per_token_stored = 0;
    config.total_staked = 0;
    config.total_rewards_claimed = 0;
    config.total_rewards_processed = 0;
    config.bump = ctx.bumps.protocol_config;

    emit!(ProtocolInitialized {
        authority: config.authority,
        fee_bps: config.fee_bps,
        usdc_mint: config.usdc_mint,
        tandem_mint: config.tandem_mint,
    });

    Ok(())
}
