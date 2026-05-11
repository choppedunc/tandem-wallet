use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

const REWARD_PRECISION: u128 = 1_000_000_000_000; // 1e12

/// Calculate fee and transfer to the staker reward and treasury ATAs.
/// Returns the total fee amount deducted.
pub fn calculate_and_transfer_fee<'info>(
    amount: u64,
    fee_bps: u16,
    total_staked: u64,
    vault_usdc_ata: &Account<'info, TokenAccount>,
    staker_reward_ata: &Account<'info, TokenAccount>,
    treasury_ata: &Account<'info, TokenAccount>,
    vault_authority: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    signer_seeds: &[&[&[u8]]],
) -> Result<u64> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(VaultError::Overflow)?
        .checked_div(10_000)
        .ok_or(VaultError::Overflow)? as u64;

    if fee == 0 {
        return Ok(0);
    }

    // If nobody is staked, send 100% to treasury to prevent orphaned rewards.
    let (staker_fee, treasury_fee) = if total_staked > 0 {
        let sf = fee / 2;
        (sf, fee - sf)
    } else {
        (0, fee)
    };

    // Transfer staker portion
    if staker_fee > 0 {
        let cpi_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault_usdc_ata.to_account_info(),
                to: staker_reward_ata.to_account_info(),
                authority: vault_authority.clone(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, staker_fee)?;
    }

    // Transfer treasury portion
    if treasury_fee > 0 {
        let cpi_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault_usdc_ata.to_account_info(),
                to: treasury_ata.to_account_info(),
                authority: vault_authority.clone(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, treasury_fee)?;
    }

    Ok(fee)
}

/// Lazy Synthetix-style reward update.
/// Call before any stake/unstake/claim to bring accounting up to date.
pub fn update_rewards(
    config: &mut ProtocolConfig,
    stake_account: Option<&mut StakeAccount>,
    reward_ata_balance: u64,
) -> Result<()> {
    // total_deposited_ever = current balance + everything already claimed
    let total_deposited_ever = (reward_ata_balance as u128)
        .checked_add(config.total_rewards_claimed as u128)
        .ok_or(VaultError::Overflow)?;

    let new_rewards = total_deposited_ever
        .checked_sub(config.total_rewards_processed as u128)
        .ok_or(VaultError::Overflow)?;

    if config.total_staked > 0 && new_rewards > 0 {
        let delta = new_rewards
            .checked_mul(REWARD_PRECISION)
            .ok_or(VaultError::Overflow)?
            .checked_div(config.total_staked as u128)
            .ok_or(VaultError::Overflow)?;
        config.reward_per_token_stored = config
            .reward_per_token_stored
            .checked_add(delta)
            .ok_or(VaultError::Overflow)?;
        config.total_rewards_processed =
            u64::try_from(total_deposited_ever).map_err(|_| VaultError::Overflow)?;
    }

    if let Some(user) = stake_account {
        let pending = (user.staked_amount as u128)
            .checked_mul(
                config
                    .reward_per_token_stored
                    .checked_sub(user.reward_per_token_paid)
                    .ok_or(VaultError::Overflow)?,
            )
            .ok_or(VaultError::Overflow)?
            .checked_div(REWARD_PRECISION)
            .ok_or(VaultError::Overflow)? as u64;
        user.rewards_owed = user
            .rewards_owed
            .checked_add(pending)
            .ok_or(VaultError::Overflow)?;
        user.reward_per_token_paid = config.reward_per_token_stored;
    }

    Ok(())
}
