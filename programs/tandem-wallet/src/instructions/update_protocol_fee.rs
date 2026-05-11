use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateProtocolFee<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.authority == authority.key() @ VaultError::OnlyAuthority,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<UpdateProtocolFee>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= 10_000, VaultError::InvalidFeeBps);

    ctx.accounts.protocol_config.fee_bps = fee_bps;

    Ok(())
}
