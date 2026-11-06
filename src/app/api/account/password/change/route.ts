import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { accountFromRequest, readJsonBody } from "@/lib/server/accountRequest";
import { changePassword } from "@/lib/server/accountStore";
import { isPasswordOk } from "@/lib/account/shared";

export const dynamic = "force-dynamic";

/**
 * 비밀번호 바꾸기 (로그인한 아이디 계정만).
 *
 * POST { current, next } → { ok: true } | { error: WRONG_PASSWORD | PASSWORD_WEAK | TOO_MANY_TRIES }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const found = await accountFromRequest(request);
  if ("response" in found) return found.response;
  const body = await readJsonBody<{ current?: unknown; next?: unknown }>(request, 2_000);
  if (!isPasswordOk(body?.next)) return jsonWithCors(request, { error: "PASSWORD_WEAK" }, { status: 400 });
  const current = typeof body?.current === "string" ? body.current.slice(0, 200) : "";
  const result = await changePassword(found.account, current, body.next);
  if (result !== "ok") {
    return jsonWithCors(request, { error: result }, { status: result === "TOO_MANY_TRIES" ? 429 : 401 });
  }
  return jsonWithCors(request, { ok: true });
}
