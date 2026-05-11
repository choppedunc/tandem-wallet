use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseProposal<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.agent == agent.key() @ VaultError::OnlyAgent,
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
        constraint = proposal.executed || proposal.cancelled @ VaultError::ProposalStillPending,
        close = agent,
    )]
    pub proposal: Account<'info, Proposal>,
}

pub fn handler(_ctx: Context<CloseProposal>) -> Result<()> {
    Ok(())
}
