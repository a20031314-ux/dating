import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { requestAuth } from "@/lib/server/request";
import { readAccount } from "@/lib/server/accountStore";
import { addReport, block, isAccountId, readBlocked, unblock } from "@/lib/server/socialStore";
import { pass, unmatch } from "@/lib/server/datingStore";
import { cardsFor } from "@/lib/server/datingCards";
import { cleanText } from "@/lib/text";

export const dynamic = "force-dynamic";

/**
 * 차단·신고 — 원본(english-chat-mvp `api/social`)에서 팔로우·사람 목록·기여 점수·게시판을 빼고 남긴 것.
 * 저장소(server/socialStore.ts)는 원본 그대로.
 *
 *   blocked                         → { cards }  내가 차단한 사람
 *   block { target }                → 차단 + 매칭 끊기 + 추천에서 빼기
 *   unblock { target }
 *   report { target, reason, lines? } → 운영자 신고함(social:v1:reports)에 남김
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

const bad = (request: NextRequest, error: string, status = 400) => jsonWithCors(request, { error }, { status });

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad(request, "Invalid JSON");
  }
  const auth = requestAuth(request);
  if (!auth) return bad(request, "SIGNED_OUT", 401);
  const me = auth.accountId;
  const action = body.action;

  if (action === "blocked") {
    return jsonWithCors(request, { cards: await cardsFor(await readBlocked(me)) });
  }

  if (!isAccountId(body.target)) return bad(request, "BAD_TARGET");
  const target = body.target;
  if (target === me) return bad(request, "SELF");

  if (action === "block") {
    if (!(await readAccount(target))) return bad(request, "NO_ACCOUNT", 404);
    const result = await block(me, target);
    if (result !== "ok") return bad(request, result, 409);
    // 매칭·대화도 끊고, 추천에 다시 안 나오게.
    await unmatch(me, target);
    await pass(me, target);
    return jsonWithCors(request, { ok: true });
  }
  if (action === "unblock") {
    await unblock(me, target);
    return jsonWithCors(request, { ok: true });
  }
  if (action === "report") {
    const reason = cleanText(body.reason, 300);
    if (!reason) return bad(request, "NO_REASON");
    const lines = Array.isArray(body.lines)
      ? body.lines.filter((line): line is string => typeof line === "string").slice(-5).map((line) => cleanText(line, 300))
      : [];
    await addReport({ at: new Date().toISOString(), reporter: me, target, reason, roomId: null, lines });
    return jsonWithCors(request, { ok: true });
  }
  return bad(request, "UNKNOWN_ACTION");
}
