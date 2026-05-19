import { NextResponse } from "next/server";
import {
  parseSyncLimit,
  requireAnalyticsAuth,
  syncAnalyticsEvents,
} from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleSync(request: Request) {
  const authError = requireAnalyticsAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const limit = parseSyncLimit(searchParams.get("limit"));
  const before = searchParams.get("before");
  const dryRun = searchParams.get("dryRun") === "1";

  try {
    const result = await syncAnalyticsEvents({ limit, before, dryRun });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  return handleSync(request);
}

export async function POST(request: Request) {
  return handleSync(request);
}
