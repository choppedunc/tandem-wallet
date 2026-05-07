use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct TransferProtocolAuthority<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.authority == authority.key() @ VaultError::OnlyAuthority,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<TransferProtocolAuthority>, new_authority: Pubkey) -> Result<()> {
    require!(new_authority != Pubkey::default(), VaultError::InvalidAuthority);

    ctx.accounts.protocol_config.authority = new_authority;

    Ok(())
}
