use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers;

#[derive(Accounts)]
pub struct SendUsdc<'info> {
    pub signer: Signer<'info>,

    #[account(
        seeds = [Vault::SEED_PREFIX, vault.human.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        constraint = vault_usdc_ata.key() == vault.vault_usdc_ata,
        constraint = vault_usdc_ata.owner == vault.key() @ VaultError::InvalidVaultAta,
        constraint = vault_usdc_ata.mint == vault.usdc_mint @ VaultError::InvalidVaultAta,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = recipient_ata.key()
            == get_associated_token_address(&recipient_ata.owner, &vault.usdc_mint)
            @ VaultError::InvalidRecipientAta,
        constraint = recipient_ata.mint == vault.usdc_mint @ VaultError::InvalidRecipientAta,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    /// Optional whitelist entry PDA. If provided and valid, bypasses tier checks.
    /// CHECK: Validated manually if present
    pub whitelist_entry: Option<Account<'info, WhitelistEntry>>,

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

pub fn handler(ctx: Context<SendUsdc>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);

    let vault = &ctx.accounts.vault;
    let signer_key = ctx.accounts.signer.key();

    let is_human = signer_key == vault.human;
    let is_agent = signer_key == vault.agent;

    // Must be human or agent
    require!(is_human || is_agent, VaultError::OnlyAgentOrHuman);

    let mut whitelisted = false;

    if !is_human {
        // Agent flow
        require!(!vault.paused, VaultError::VaultPaused);

        // Check whitelist
        if let Some(ref wl_entry) = ctx.accounts.whitelist_entry {
            if wl_entry.vault == vault.key()
                && wl_entry.address == ctx.accounts.recipient_ata.owner
            {
                whitelisted = true;
            }
        }

        if !whitelisted {
            require!(amount <= vault.spending_limit, VaultError::OverSpendingLimit);
        }
    }

    // Execute transfer using vault PDA as signer
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
    token::transfer(cpi_ctx, amount)?;

    // Calculate and transfer fee
    let fee = helpers::calculate_and_transfer_fee(
        amount,
        ctx.accounts.protocol_config.fee_bps,
        ctx.accounts.protocol_config.total_staked,
        &ctx.accounts.vault_usdc_ata,
        &ctx.accounts.staker_reward_ata,
        &ctx.accounts.treasury_ata,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.token_program,
        signer_seeds,
    )?;

    emit!(UsdcSent {
        vault: vault.key(),
        signer: signer_key,
        recipient: ctx.accounts.recipient_ata.owner,
        amount,
        fee,
        whitelisted,
    });

    Ok(())
}
