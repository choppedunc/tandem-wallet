import { NextResponse } from "next/server";
import {
  ANALYTICS_NETWORK,
  ensureAnalyticsSchema,
  formatUsdcRaw,
  getSqlClient,
  requireAnalyticsAuth,
} from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatsRow = {
  vaults_created: string | number;
  unique_human_wallets: string | number;
  direct_send_count: string | number;
  approved_proposal_payment_count: string | number;
  fulfilled_transaction_count: string | number;
  proposal_created_count: string | number;
  proposal_cancelled_count: string | number;
  whitelisted_direct_send_count: string | number;
  direct_send_volume_raw: string | number;
  approved_proposal_volume_raw: string | number;
  total_fulfilled_volume_raw: string | number;
  total_fee_volume_raw: string | number;
  latest_block_time: string | Date | null;
  latest_inserted_at: string | Date | null;
};

function asCount(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

function asTimestamp(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function GET(request: Request) {
  const authError = requireAnalyticsAuth(request);
  if (authError) return authError;

  try {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    const rows = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE event_name = 'VaultInitialized') AS vaults_created,
        COUNT(DISTINCT human_wallet) FILTER (
          WHERE event_name = 'VaultInitialized' AND human_wallet IS NOT NULL
        ) AS unique_human_wallets,
        COUNT(*) FILTER (WHERE event_name = 'UsdcSent') AS direct_send_count,
        COUNT(*) FILTER (WHERE event_name = 'ProposalApproved') AS approved_proposal_payment_count,
        COUNT(*) FILTER (
          WHERE event_name IN ('UsdcSent', 'ProposalApproved')
        ) AS fulfilled_transaction_count,
        COUNT(*) FILTER (WHERE event_name = 'ProposalCreated') AS proposal_created_count,
        COUNT(*) FILTER (WHERE event_name = 'ProposalCancelled') AS proposal_cancelled_count,
        COUNT(*) FILTER (
          WHERE event_name = 'UsdcSent' AND whitelisted IS TRUE
        ) AS whitelisted_direct_send_count,
        COALESCE(SUM(amount_usdc_raw) FILTER (
          WHERE event_name = 'UsdcSent'
        ), 0)::text AS direct_send_volume_raw,
        COALESCE(SUM(amount_usdc_raw) FILTER (
          WHERE event_name = 'ProposalApproved'
        ), 0)::text AS approved_proposal_volume_raw,
        COALESCE(SUM(amount_usdc_raw) FILTER (
          WHERE event_name IN ('UsdcSent', 'ProposalApproved')
        ), 0)::text AS total_fulfilled_volume_raw,
        COALESCE(SUM(fee_usdc_raw) FILTER (
          WHERE event_name IN ('UsdcSent', 'ProposalApproved')
        ), 0)::text AS total_fee_volume_raw,
        MAX(block_time) AS latest_block_time,
        MAX(inserted_at) AS latest_inserted_at
      FROM tandem_analytics_events
      WHERE network = ${ANALYTICS_NETWORK}
    `) as StatsRow[];

    const stats = rows[0];
    return NextResponse.json({
      network: ANALYTICS_NETWORK,
      totals: {
        vaultsCreated: asCount(stats?.vaults_created),
        uniqueHumanWallets: asCount(stats?.unique_human_wallets),
        directSends: asCount(stats?.direct_send_count),
        approvedProposalPayments: asCount(stats?.approved_proposal_payment_count),
        fulfilledTransactions: asCount(stats?.fulfilled_transaction_count),
        proposalsCreated: asCount(stats?.proposal_created_count),
        proposalsCancelled: asCount(stats?.proposal_cancelled_count),
        whitelistedDirectSends: asCount(stats?.whitelisted_direct_send_count),
        directSendUsdcVolumeRaw: String(stats?.direct_send_volume_raw ?? "0"),
        directSendUsdcVolume: formatUsdcRaw(stats?.direct_send_volume_raw),
        approvedProposalUsdcVolumeRaw: String(
          stats?.approved_proposal_volume_raw ?? "0"
        ),
        approvedProposalUsdcVolume: formatUsdcRaw(
          stats?.approved_proposal_volume_raw
        ),
        totalFulfilledUsdcVolumeRaw: String(
          stats?.total_fulfilled_volume_raw ?? "0"
        ),
        totalFulfilledUsdcVolume: formatUsdcRaw(
          stats?.total_fulfilled_volume_raw
        ),
        totalFeeUsdcVolumeRaw: String(stats?.total_fee_volume_raw ?? "0"),
        totalFeeUsdcVolume: formatUsdcRaw(stats?.total_fee_volume_raw),
      },
      latestBlockTime: asTimestamp(stats?.latest_block_time),
      latestInsertedAt: asTimestamp(stats?.latest_inserted_at),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
