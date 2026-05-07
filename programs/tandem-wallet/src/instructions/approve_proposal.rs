use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers;

#[derive(Accounts)]
pub struct ApproveProposal<'info> {
    pub human: Signer<'info>,

    #[account(
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        constraint = vault.human == human.key() @ VaultError::OnlyHuman,
        constraint = !vault.paused @ VaultError::VaultPaused,
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

    #[account(
        mut,
        constraint = vault_usdc_ata.key() == vault.vault_usdc_ata,
        constraint = vault_usdc_ata.owner == vault.key() @ VaultError::InvalidVaultAta,
        constraint = vault_usdc_ata.mint == vault.usdc_mint @ VaultError::InvalidVaultAta,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = recipient_ata.key() == proposal.recipient_ata,
        constraint = recipient_ata.key()
            == get_associated_token_address(&proposal.recipient, &vault.usdc_mint)
            @ VaultError::InvalidRecipientAta,
        constraint = recipient_ata.owner == proposal.recipient @ VaultError::InvalidRecipientAta,
        constraint = recipient_ata.mint == vault.usdc_mint @ VaultError::InvalidRecipientAta,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    /// Protocol config for fee calculation
    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// Staker reward USDC ATA (receives 50% of fee when staking is active)
    #[account(
        mut,
        constraint = staker_reward_ata.key() == protocol_config.staker_reward_ata,
    )]
    pub staker_reward_ata: Account<'info, TokenAccount>,

    /// Treasury USDC ATA (receives 50% of fee, or 100% when nobody is staked)
    #[account(
        mut,
        constraint = treasury_ata.key() == protocol_config.treasury_ata,
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ApproveProposal>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let proposal = &mut ctx.accounts.proposal;

    // Execute transfer
    let human_key = vault.human;
    let agent_key = vault.agent;
    let bump = vault.bump;
    let seeds = &[
        Vault::SEED_PREFIX,
        human_key.as_ref(),
        agent_key.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_usdc_ata.to_account_info(),
            to: ctx.accounts.recipient_ata.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(cpi_ctx, proposal.amount)?;

    // Calculate and transfer fee
    let fee = helpers::calculate_and_transfer_fee(
        proposal.amount,
        ctx.accounts.protocol_config.fee_bps,
        ctx.accounts.protocol_config.total_staked,
        &ctx.accounts.vault_usdc_ata,
        &ctx.accounts.staker_reward_ata,
        &ctx.accounts.treasury_ata,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.token_program,
        signer_seeds,
    )?;

    proposal.executed = true;

    emit!(ProposalApproved {
        vault: vault.key(),
        proposal_id: proposal.proposal_id,
        recipient: proposal.recipient,
        amount: proposal.amount,
        fee,
    });

    Ok(())
}
