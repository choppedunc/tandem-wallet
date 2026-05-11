use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub human: Signer<'info>,

    #[account(
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.human == human.key() @ VaultError::OnlyHuman,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [
            Proposal::SEED_PREFIX,
            vault.key().as_ref(),
            proposal.proposal_id.to_le_bytes().as_ref(),
        ],
        bump = proposal.bump,
        constraint = proposal.vault == vault.key(),
        constraint = !proposal.executed @ VaultError::ProposalAlreadyExecuted,
        constraint = !proposal.cancelled @ VaultError::ProposalAlreadyCancelled,
    )]
    pub proposal: Account<'info, Proposal>,
}

pub fn handler(ctx: Context<CancelProposal>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    proposal.cancelled = true;

    emit!(ProposalCancelled {
        vault: ctx.accounts.vault.key(),
        proposal_id: proposal.proposal_id,
    });

    Ok(())
}
