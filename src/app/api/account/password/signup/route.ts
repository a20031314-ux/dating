import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { authDisabled, loginResponse, readJsonBody } from "@/lib/server/accountRequest";
import { createPasswordAccount } from "@/lib/server/accountStore";
import { requestUserId } from "@/lib/server/request";
import { isPasswordOk, normalizeUsername } from "@/lib/account/shared";

export const dynamic = "force-dynamic";

/**
 * 아이디·비밀번호로 가입하고 바로 로그인. 이 기기의 기록이 계정 기록이 된다.
 *
 * POST { username, password } → { token, account, created: true }
 *   | { error: USERNAME_INVALID | PASSWORD_WEAK | USERNAME_TAKEN }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const disabled = authDisabled(request);
  if (disabled) return disabled;
  const body = await readJsonBody<{ username?: unknown; password?: unknown }>(request, 2_000);
  const username = normalizeUsername(body?.username);
  if (!username) return jsonWithCors(request, { error: "USERNAME_INVALID" }, { status: 400 });
  if (!isPasswordOk(body?.password)) return jsonWithCors(request, { error: "PASSWORD_WEAK" }, { status: 400 });

  const result = await createPasswordAccount(username, body.password, requestUserId(request));
  if ("error" in result) {
    return jsonWithCors(request, { error: result.error }, { status: result.error === "USERNAME_TAKEN" ? 409 : 503 });
  }
  return loginResponse(request, result.account, true);
}
