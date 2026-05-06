use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;
use crate::events::*;

#[derive(Accounts)]
pub struct SetLimit<'info> {
    pub human: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.human == human.key() @ VaultError::OnlyHuman,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handler(ctx: Context<SetLimit>, spending_limit: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.spending_limit = spending_limit;

    emit!(SpendingLimitUpdated {
        vault: vault.key(),
        spending_limit,
    });

    Ok(())
}
