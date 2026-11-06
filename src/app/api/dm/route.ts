import { NextRequest } from "next/server";
import { pollFrom } from "@/lib/server/lateRows";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { requestAuth } from "@/lib/server/request";
import { readAccount, readReceiptsOff } from "@/lib/server/accountStore";
import { blockedEitherWay, isAccountId } from "@/lib/server/socialStore";
import { findQuote, hiddenUpTo, hideThread, inbox, markRead, readGone, readUpTo, readMessages, readThread, send, unsend, withoutGone } from "@/lib/server/dmStore";
import { isMatched } from "@/lib/server/datingStore";
import { cleanFocus, type LineQuote } from "@/lib/rooms/quote";
import { DM_MAX_CHARS, isThreadId, otherOf, threadIdFor } from "@/lib/rooms/dm";
import { cleanText } from "@/lib/text";
import { suspendedResponse } from "@/lib/server/suspension";

export const dynamic = "force-dynamic";

/**
 * 1:1 메시지 — 원본(english-chat-mvp `api/dm`)을 데이팅용으로 고친 것.
 *
 * 바뀐 점: **매칭된 사람끼리만** 보낼 수 있다(datingStore.isMatched). 매칭 순간 대화가 이미 열려 있어서
 * (openThreadDirect) 원본의 "요청 → 수락" 단계는 쓰지 않는다. 통화 방·아이콘·방 줄 인용·입장 코드는 뺐다.
 * 저장소(server/dmStore.ts)는 원본 그대로 — 메시지는 마지막 메시지로부터 30일.
 *
 *   inbox                     → { threads: DmSummary[] }
 *   open { target }           → { thread | null, messages, blocked, gone, peerRead }   (읽음 표시)
 *   poll { threadId, since }  → { thread, messages, gone, peerRead }
 *   send { target, text, quoteSeq? } → { thread, message }
 *   unsend { threadId, seq }  → 모두에게서 지우기(내 줄만)
 *   hide { threadId }         → 내 목록에서 숨기기
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

  if (action === "send") {
    const stop = await suspendedResponse(request, me);
    if (stop) return stop;
  }
  if (action === "inbox") return jsonWithCors(request, { threads: await inbox(me) });

  if (action === "open" || action === "send") {
    if (!isAccountId(body.target) || body.target === me) return bad(request, "BAD_TARGET");
    const target = body.target;
    if (!(await readAccount(target))) return bad(request, "NO_ACCOUNT", 404);
    const blocked = await blockedEitherWay(me, target);
    const id = threadIdFor(me, target);
    if (action === "open") {
      const thread = await readThread(id);
      const hidden = thread ? await hiddenUpTo(me, id) : 0;
      const gone = thread ? await readGone(id) : [];
      const messages = thread ? withoutGone((await readMessages(id)).filter((row) => row.seq > hidden), gone) : [];
      if (thread?.lastSeq) await markRead(me, id, thread.lastSeq);
      const peerRead = thread ? await shownPeerRead(me, target, id) : 0;
      const matched = await isMatched(me, target);
      return jsonWithCors(request, { thread, messages, blocked, gone, peerRead, matched });
    }
    if (blocked) return bad(request, "BLOCKED", 403);
    if (!(await isMatched(me, target))) return bad(request, "NOT_MATCHED", 403);
    const text = cleanText(body.text, DM_MAX_CHARS);
    if (!text) return bad(request, "NO_TEXT");
    let quote: LineQuote | undefined = undefined;
    if (typeof body.quoteSeq === "number") {
      quote = (await findQuote(id, body.quoteSeq)) ?? undefined;
      if (!quote) return bad(request, "NO_QUOTE", 404);
      const focus = cleanFocus(quote.text, body.quoteFocus);
      if (focus) quote = { ...quote, focus };
    }
    const result = await send({ from: me, to: target, kind: "text", text, ...(quote ? { quote } : {}) });
    if (!result.ok) return bad(request, result.error, 409);
    return jsonWithCors(request, { thread: result.thread, message: result.message });
  }

  if (!isThreadId(body.threadId)) return bad(request, "BAD_THREAD");
  const thread = await readThread(body.threadId);
  if (!thread || !thread.members.includes(me)) return bad(request, "NO_THREAD", 404);
  const other = otherOf(thread, me);

  if (action === "poll") {
    const since = typeof body.since === "number" && Number.isFinite(body.since) ? body.since : 0;
    const [hidden, gone] = await Promise.all([hiddenUpTo(me, thread.id), readGone(thread.id)]);
    const messages = withoutGone((await readMessages(thread.id, pollFrom(since))).filter((row) => row.seq > hidden), gone);
    if (thread.lastSeq) await markRead(me, thread.id, thread.lastSeq);
    const peerRead = await shownPeerRead(me, other, thread.id);
    return jsonWithCors(request, { thread, messages, gone, peerRead });
  }

  if (action === "unsend") {
    if (typeof body.seq !== "number" || !Number.isInteger(body.seq)) return bad(request, "BAD_SEQ");
    const result = await unsend(me, thread.id, body.seq);
    if (!result.ok) return bad(request, result.error, result.error === "NOT_YOURS" ? 403 : 404);
    return jsonWithCors(request, { ok: true });
  }

  if (action === "hide") {
    return (await hideThread(me, thread.id)) ? jsonWithCors(request, { ok: true }) : bad(request, "NO_THREAD", 404);
  }

  return bad(request, "UNKNOWN_ACTION");
}

/** 상대가 읽은 줄 번호 — 나나 상대가 읽음 표시를 껐으면 0. */
async function shownPeerRead(me: string, other: string, threadId: string): Promise<number> {
  const [off, read] = await Promise.all([readReceiptsOff([me, other]), readUpTo(other, threadId)]);
  return off.some(Boolean) ? 0 : read;
}
