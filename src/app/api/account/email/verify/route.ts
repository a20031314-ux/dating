import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { authDisabled, loginResponse, readJsonBody } from "@/lib/server/accountRequest";
import { checkEmailCode, findOrCreateAccount } from "@/lib/server/accountStore";
import { requestUserId } from "@/lib/server/request";
import { isEmailCode, normalizeEmail } from "@/lib/account/shared";

export const dynamic = "force-dynamic";

/**
 * 코드를 확인하고 로그인한다. 처음이면 계정을 만들고 이 기기의 기록을 계정에 묶는다.
 *
 * POST { email, code } → { token, account, created } | { error: WRONG_CODE | CODE_EXPIRED | TOO_MANY_TRIES }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const disabled = authDisabled(request);
  if (disabled) return disabled;

  const body = await readJsonBody<{ email?: unknown; code?: unknown }>(request, 2_000);
  const email = normalizeEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !isEmailCode(code)) return jsonWithCors(request, { error: "WRONG_CODE" }, { status: 400 });

  const check = await checkEmailCode(email, code);
  if (check === "wrong") return jsonWithCors(request, { error: "WRONG_CODE" }, { status: 400 });
  if (check === "expired") return jsonWithCors(request, { error: "CODE_EXPIRED" }, { status: 400 });
  if (check === "locked") return jsonWithCors(request, { error: "TOO_MANY_TRIES" }, { status: 429 });

  const { account, created } = await findOrCreateAccount({ kind: "email", email }, requestUserId(request));
  return loginResponse(request, account, created);
}
