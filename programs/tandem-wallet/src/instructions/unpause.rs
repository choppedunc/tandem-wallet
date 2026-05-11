use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Unpause<'info> {
    pub human: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.human == human.key() @ VaultError::OnlyHuman,
        constraint = vault.paused @ VaultError::VaultNotPaused,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handler(ctx: Context<Unpause>) -> Result<()> {
    ctx.accounts.vault.paused = false;

    emit!(VaultUnpausedEvent {
        vault: ctx.accounts.vault.key(),
    });

    Ok(())
}
