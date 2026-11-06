import { NextRequest, NextResponse } from "next/server";
import { purgeDeletedAccounts } from "@/lib/server/accountPurge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 매주 Vercel 크론(vercel.json)이 부른다: 지운 계정의 학습 기록을 지운다.
 * Vercel이 `Authorization: Bearer $CRON_SECRET`을 붙여 보낸다 — CRON_SECRET이
 * 없으면 아무도 못 부른다(그때는 scripts/account-purge.mjs를 사람이 돌린다).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const report = await purgeDeletedAccounts({ apply: true, deadline: Date.now() + 240_000 });
  console.log("[account-purge]", report);
  return NextResponse.json(report);
}
