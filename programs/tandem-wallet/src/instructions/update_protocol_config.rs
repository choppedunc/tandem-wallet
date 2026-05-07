use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::TokenAccount;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct UpdateProtocolConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.authority == authority.key() @ VaultError::OnlyAuthority,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// New treasury ATA (optional — pass same as current if not changing)
    #[account(
        constraint = treasury_ata.mint == protocol_config.usdc_mint @ VaultError::InvalidTreasuryAta,
        constraint = treasury_ata.key()
            == get_associated_token_address(&treasury_ata.owner, &protocol_config.usdc_mint)
            @ VaultError::InvalidTreasuryAta,
    )]
    pub treasury_ata: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<UpdateProtocolConfig>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= 10_000, VaultError::InvalidFeeBps);

    let config = &mut ctx.accounts.protocol_config;
    config.fee_bps = fee_bps;
    config.treasury_ata = ctx.accounts.treasury_ata.key();

    Ok(())
}
