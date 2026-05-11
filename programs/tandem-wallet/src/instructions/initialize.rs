use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub human: Signer<'info>,

    /// CHECK: Agent pubkey, doesn't need to sign initialization
    pub agent: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = usdc_mint.key() == protocol_config.usdc_mint @ VaultError::InvalidUsdcMint,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = human,
        space = 8 + Vault::INIT_SPACE,
        seeds = [Vault::SEED_PREFIX, human.key().as_ref(), agent.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = human,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>, spending_limit: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.human = ctx.accounts.human.key();
    vault.agent = ctx.accounts.agent.key();
    vault.usdc_mint = ctx.accounts.usdc_mint.key();
    vault.vault_usdc_ata = ctx.accounts.vault_usdc_ata.key();
    vault.spending_limit = spending_limit;
    vault.paused = false;
    vault.proposal_count = 0;
    vault.bump = ctx.bumps.vault;

    emit!(VaultInitialized {
        vault: vault.key(),
        human: vault.human,
        agent: vault.agent,
        usdc_mint: vault.usdc_mint,
    });

    Ok(())
}
