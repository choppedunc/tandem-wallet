use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;

#[derive(Accounts)]
pub struct Propose<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.agent == agent.key() @ VaultError::OnlyAgent,
        constraint = !vault.paused @ VaultError::VaultPaused,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: Recipient wallet address
    #[account(
        constraint = recipient.key() != vault.key() @ VaultError::InvalidRecipientAta,
    )]
    pub recipient: UncheckedAccount<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.usdc_mint == vault.usdc_mint @ VaultError::InvalidUsdcMint,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: The account may not exist yet, but its address must be the
    /// recipient's associated token account for this vault's USDC mint.
    #[account(
        constraint = recipient_ata.key() != vault.vault_usdc_ata @ VaultError::InvalidRecipientAta,
        constraint = recipient_ata.key() != protocol_config.staker_reward_ata @ VaultError::InvalidRecipientAta,
        constraint = recipient_ata.key() != protocol_config.treasury_ata @ VaultError::InvalidRecipientAta,
        constraint = recipient_ata.key()
            == get_associated_token_address(&recipient.key(), &vault.usdc_mint)
            @ VaultError::InvalidRecipientAta,
    )]
    pub recipient_ata: UncheckedAccount<'info>,

    #[account(
        init,
        payer = agent,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [
            Proposal::SEED_PREFIX,
            vault.key().as_ref(),
            vault.proposal_count.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Propose>, amount: u64, memo: String) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);
    require!(memo.len() <= 128, VaultError::Overflow);

    let vault = &mut ctx.accounts.vault;
    let proposal_id = vault.proposal_count;
    vault.proposal_count = vault
        .proposal_count
        .checked_add(1)
        .ok_or(VaultError::Overflow)?;

    let proposal = &mut ctx.accounts.proposal;
    proposal.vault = vault.key();
    proposal.proposal_id = proposal_id;
    proposal.recipient = ctx.accounts.recipient.key();
    proposal.recipient_ata = ctx.accounts.recipient_ata.key();
    proposal.amount = amount;
    proposal.proposed_at = Clock::get()?.unix_timestamp;
    proposal.executed = false;
    proposal.cancelled = false;
    proposal.memo = memo.clone();
    proposal.bump = ctx.bumps.proposal;

    emit!(ProposalCreated {
        vault: vault.key(),
        proposal_id,
        recipient: proposal.recipient,
        amount,
        memo,
    });

    Ok(())
}
