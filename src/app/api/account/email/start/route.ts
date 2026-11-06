import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { authDisabled, readJsonBody } from "@/lib/server/accountRequest";
import { createEmailCode } from "@/lib/server/accountStore";
import { emailConfigured, sendLoginCode } from "@/lib/server/emailSender";
import { EMAIL_CODE_TTL_SECONDS, normalizeEmail } from "@/lib/account/shared";

export const dynamic = "force-dynamic";

/**
 * 이메일로 6자리 코드를 보낸다. 주소 하나에 한 시간 5번까지.
 *
 * POST { email, locale } → { ok: true } | { error: INVALID_EMAIL | RATE_LIMITED | EMAIL_DISABLED | SEND_FAILED }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const disabled = authDisabled(request);
  if (disabled) return disabled;
  if (!emailConfigured()) return jsonWithCors(request, { error: "EMAIL_DISABLED" }, { status: 503 });

  const body = await readJsonBody<{ email?: unknown; locale?: unknown }>(request, 2_000);
  const email = normalizeEmail(body?.email);
  if (!email) return jsonWithCors(request, { error: "INVALID_EMAIL" }, { status: 400 });

  const code = await createEmailCode(email);
  if (!code) return jsonWithCors(request, { error: "RATE_LIMITED" }, { status: 429 });

  const locale = typeof body?.locale === "string" ? body.locale.slice(0, 8) : null;
  const sent = await sendLoginCode(email, code, locale, Math.round(EMAIL_CODE_TTL_SECONDS / 60));
  if (!sent) return jsonWithCors(request, { error: "SEND_FAILED" }, { status: 502 });
  return jsonWithCors(request, { ok: true });
}
