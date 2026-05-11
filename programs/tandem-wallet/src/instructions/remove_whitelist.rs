use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RemoveWhitelist<'info> {
    #[account(mut)]
    pub human: Signer<'info>,

    #[account(
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.human == human.key() @ VaultError::OnlyHuman,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [WhitelistEntry::SEED_PREFIX, vault.key().as_ref(), whitelist_entry.address.as_ref()],
        bump = whitelist_entry.bump,
        constraint = whitelist_entry.vault == vault.key(),
        close = human,
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,
}

pub fn handler(_ctx: Context<RemoveWhitelist>) -> Result<()> {
    emit!(WhitelistRemoved {
        vault: _ctx.accounts.vault.key(),
        address: _ctx.accounts.whitelist_entry.address,
    });

    Ok(())
}
