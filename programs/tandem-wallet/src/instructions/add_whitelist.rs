use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct AddWhitelist<'info> {
    #[account(mut)]
    pub human: Signer<'info>,

    #[account(
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.human == human.key() @ VaultError::OnlyHuman,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = human,
        space = 8 + WhitelistEntry::INIT_SPACE,
        seeds = [WhitelistEntry::SEED_PREFIX, vault.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddWhitelist>, address: Pubkey) -> Result<()> {
    let wl = &mut ctx.accounts.whitelist_entry;
    wl.vault = ctx.accounts.vault.key();
    wl.address = address;
    wl.added_at = Clock::get()?.unix_timestamp;
    wl.bump = ctx.bumps.whitelist_entry;

    emit!(WhitelistAdded {
        vault: ctx.accounts.vault.key(),
        address,
    });

    Ok(())
}
