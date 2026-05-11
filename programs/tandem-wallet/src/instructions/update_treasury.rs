use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct UpdateTreasury<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.authority == authority.key() @ VaultError::OnlyAuthority,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// New treasury ATA.
    #[account(
        constraint = treasury_ata.mint == protocol_config.usdc_mint @ VaultError::InvalidTreasuryAta,
        constraint = treasury_ata.key() != protocol_config.staker_reward_ata @ VaultError::InvalidTreasuryAta,
        constraint = treasury_ata.key()
            == get_associated_token_address(&treasury_ata.owner, &protocol_config.usdc_mint)
            @ VaultError::InvalidTreasuryAta,
    )]
    pub treasury_ata: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<UpdateTreasury>) -> Result<()> {
    ctx.accounts.protocol_config.treasury_ata = ctx.accounts.treasury_ata.key();

    Ok(())
}
