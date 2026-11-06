import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { authDisabled, loginResponse, readJsonBody } from "@/lib/server/accountRequest";
import { loginWithPassword } from "@/lib/server/accountStore";
import { normalizeUsername, PASSWORD_MAX } from "@/lib/account/shared";

export const dynamic = "force-dynamic";

/**
 * 아이디·비밀번호 로그인. 아이디가 없어도 비밀번호가 틀려도 같은 답.
 * 한 아이디에 한 시간 10번 틀리면 잠깐 막힌다.
 *
 * POST { username, password } → { token, account, created: false } | { error: WRONG_PASSWORD | TOO_MANY_TRIES }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const disabled = authDisabled(request);
  if (disabled) return disabled;
  const body = await readJsonBody<{ username?: unknown; password?: unknown }>(request, 2_000);
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password || password.length > PASSWORD_MAX) {
    return jsonWithCors(request, { error: "WRONG_PASSWORD" }, { status: 401 });
  }
  const result = await loginWithPassword(username, password);
  if ("error" in result) {
    return jsonWithCors(request, { error: result.error }, { status: result.error === "TOO_MANY_TRIES" ? 429 : 401 });
  }
  return loginResponse(request, result.account, false);
}
