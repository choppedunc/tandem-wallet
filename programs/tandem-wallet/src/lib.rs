use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("6L2hon3xSV9saeaGG7cgFG298JGW4vf9jDtF5xg8E6pZ");

#[program]
pub mod tandem_wallet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, spending_limit: u64) -> Result<()> {
        instructions::initialize::handler(ctx, spending_limit)
    }

    pub fn send_usdc(ctx: Context<SendUsdc>, amount: u64) -> Result<()> {
        instructions::send_usdc::handler(ctx, amount)
    }

    pub fn propose(ctx: Context<Propose>, amount: u64, memo: String) -> Result<()> {
        instructions::propose::handler(ctx, amount, memo)
    }

    pub fn approve_proposal(ctx: Context<ApproveProposal>) -> Result<()> {
        instructions::approve_proposal::handler(ctx)
    }

    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        instructions::cancel_proposal::handler(ctx)
    }

    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        instructions::close_proposal::handler(ctx)
    }

    pub fn set_limit(ctx: Context<SetLimit>, spending_limit: u64) -> Result<()> {
        instructions::set_limit::handler(ctx, spending_limit)
    }

    pub fn add_whitelist(ctx: Context<AddWhitelist>, address: Pubkey) -> Result<()> {
        instructions::add_whitelist::handler(ctx, address)
    }

    pub fn remove_whitelist(ctx: Context<RemoveWhitelist>) -> Result<()> {
        instructions::remove_whitelist::handler(ctx)
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx)
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::unpause::handler(ctx)
    }

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>, fee_bps: u16) -> Result<()> {
        instructions::initialize_protocol::handler(ctx, fee_bps)
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler(ctx, amount)
    }

    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        instructions::unstake::handler(ctx)
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::claim_rewards::handler(ctx)
    }

    pub fn update_protocol_fee(ctx: Context<UpdateProtocolFee>, fee_bps: u16) -> Result<()> {
        instructions::update_protocol_fee::handler(ctx, fee_bps)
    }

    pub fn update_treasury(ctx: Context<UpdateTreasury>) -> Result<()> {
        instructions::update_treasury::handler(ctx)
    }

    pub fn transfer_protocol_authority(
        ctx: Context<TransferProtocolAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::transfer_protocol_authority::handler(ctx, new_authority)
    }
}
