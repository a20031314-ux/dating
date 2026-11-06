/**
 * 1:1 메시지 저장소 (KV). 규칙은 rooms/dm.ts.
 *
 *   dm:v1:t:<대화>          대화 한 줄(DmThread) — 보낼 때마다 마지막 말 갱신
 *   dm:v1:m:<대화>          줄 목록(RPUSH) — 둘이 동시에 써도 엉키지 않음
 *   dm:v1:seq:<대화>        줄 번호
 *   dm:v1:box:<계정>        내가 낀 대화 id 목록(RPUSH, 읽을 때 겹친 것 정리)
 *   dm:v1:read:<계정>:<대화> 내가 읽은 마지막 줄 번호(나만 씀)
 *   dm:v1:log:<방>          통화 기록을 한 번만 남기기(SET NX)
 *
 * 모두 마지막 활동으로부터 30일(DM_TTL_SECONDS)이면 사라진다.
 */
import { rowsAfter } from "./lateRows.ts";
import {
  DM_MAX_KEPT,
  DM_TTL_SECONDS,
  canSend,
  otherOf,
  threadIdFor,
  type DmMessage,
  type DmSummary,
  type DmThread,
  type SendDecision,
} from "../rooms/dm.ts";
import { clipQuote, type LineQuote } from "../rooms/quote.ts";
import { kvGetJson, kvIncrBy, kvListPush, kvListRange, kvListRemove, kvListTrim, kvSetJson, kvSetJsonIfAbsent } from "./kv.ts";

const threadKey = (id: string) => `dm:v1:t:${id}`;
const msgsKey = (id: string) => `dm:v1:m:${id}`;
const seqKey = (id: string) => `dm:v1:seq:${id}`;
const boxKey = (account: string) => `dm:v1:box:${account}`;
const readKey = (account: string, id: string) => `dm:v1:read:${account}:${id}`;
const logKey = (roomId: string) => `dm:v1:log:${roomId}`;
/** 내 목록에서 지운 대화: 지울 때의 마지막 번호. 그 뒤 새 줄이 오면 다시 보이고, 지우기 전 줄은 나에게만 안 보인다. */
const hideKey = (account: string, id: string) => `dm:v1:hide:${account}:${id}`;
/** 모두에게서 지운 줄 번호들 — 이미 받아 둔 앱이 지우도록 poll에 같이 보낸다. */
const goneKey = (id: string) => `dm:v1:gone:${id}`;
const GONE_KEEP = 200;
const BOX_KEEP = 200;

export async function readThread(id: string): Promise<DmThread | null> {
  return kvGetJson<DmThread>(threadKey(id));
}

function parse(rows: string[]): DmMessage[] {
  const out: DmMessage[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row) as DmMessage);
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }
  return out;
}

export async function readMessages(id: string, since = 0): Promise<DmMessage[]> {
  return rowsAfter(parse(await kvListRange(msgsKey(id), -DM_MAX_KEPT, -1)), since);
}

export type SendResult = { ok: true; thread: DmThread; message: DmMessage } | { ok: false; error: SendDecision | "BLOCKED" };

/**
 * 한 줄 보내기(글·통화 요청·통화 기록). 대화가 없으면 만든다(보낸 사람이 starter).
 * 받는 사람이 처음 답하면 대화가 열린다.
 */
export async function send(input: {
  from: string;
  to: string;
  kind: DmMessage["kind"];
  text: string;
  roomId?: string;
  lines?: DmMessage["lines"];
  quote?: DmMessage["quote"];
  ask?: boolean;
  image?: DmMessage["image"];
  icon?: DmMessage["icon"];
}): Promise<SendResult> {
  const id = threadIdFor(input.from, input.to);
  const existing = await readThread(id);
  let starterSent = 0;
  if (existing && existing.status === "pending" && existing.starter === input.from) {
    starterSent = (await readMessages(id)).filter((message) => message.from === input.from && message.kind === "text").length;
  }
  if (input.kind === "text") {
    const decision = canSend(existing, input.from, starterSent);
    if (decision !== "ok") return { ok: false, error: decision };
  } else if (!existing || existing.status !== "open") {
    // 통화는 열린 대화에서만.
    return { ok: false, error: "PENDING_LIMIT" };
  }

  const now = Date.now();
  const seq = await kvIncrBy(seqKey(id), 1, DM_TTL_SECONDS);
  const message: DmMessage = {
    seq,
    from: input.from,
    kind: input.kind,
    text: input.text,
    at: now,
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.lines ? { lines: input.lines } : {}),
    ...(input.quote ? { quote: input.quote, ask: input.ask === true } : {}),
    ...(input.image ? { image: input.image } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
  };
  // 목록 미리보기: 사진만 보냈으면 📷(화면이 그 언어 "사진"으로 바꿔 보인다).
  const preview = input.image ? (input.text ? `📷 ${input.text}` : "📷") : input.icon && !input.text ? "🙂" : input.text;
  const members = [input.from, input.to].sort() as [string, string];
  const thread: DmThread = existing
    ? {
        ...existing,
        // 받는 사람의 답이 대화를 연다(거절했다가 답해도 연다).
        status: existing.starter !== input.from ? "open" : existing.status,
        lastAt: now,
        lastText: input.kind === "text" ? preview : existing.lastText,
        lastFrom: input.from,
        lastSeq: seq,
      }
    : {
        id,
        members,
        starter: input.from,
        status: "pending",
        createdAt: now,
        lastAt: now,
        lastText: preview,
        lastFrom: input.from,
        lastSeq: seq,
      };
  await kvListPush(msgsKey(id), [JSON.stringify(message)], DM_TTL_SECONDS);
  await kvListTrim(msgsKey(id), DM_MAX_KEPT);
  await kvSetJson(threadKey(id), thread, DM_TTL_SECONDS);
  if (!existing) {
    for (const account of members) {
      await kvListPush(boxKey(account), [id], DM_TTL_SECONDS);
      await kvListTrim(boxKey(account), BOX_KEEP);
    }
  }
  // 보낸 사람은 자기 줄을 읽은 것으로.
  await kvSetJson(readKey(input.from, id), seq, DM_TTL_SECONDS);
  return { ok: true, thread, message };
}

/**
 * 요청·수락 없이 바로 열린 대화(랜덤 연결, lib/random/protocol.ts — 둘 다 성인인증하고 "랜덤"을 눌러 만났다).
 * 이미 대화가 있으면 그대로 열고, 없으면 빈 대화를 만든다. 대화는 다른 1:1과 같이 30일 남는다(법 ② 대화 저장).
 */
export async function openThreadDirect(a: string, b: string, now: number = Date.now()): Promise<DmThread> {
  const id = threadIdFor(a, b);
  const existing = await readThread(id);
  const members = [a, b].sort() as [string, string];
  const thread: DmThread = existing
    ? { ...existing, status: "open", lastAt: now }
    : { id, members, starter: a, status: "open", createdAt: now, lastAt: now, lastText: "", lastFrom: a, lastSeq: 0 };
  await kvSetJson(threadKey(id), thread, DM_TTL_SECONDS);
  if (!existing) {
    for (const account of members) {
      await kvListPush(boxKey(account), [id], DM_TTL_SECONDS);
      await kvListTrim(boxKey(account), BOX_KEEP);
    }
  }
  return thread;
}

/** 받는 사람이 요청을 거절: 보낸 사람은 더 보낼 수 없다(받는 사람이 답하면 다시 열림). */
export async function decline(me: string, id: string): Promise<boolean> {
  const thread = await readThread(id);
  if (!thread || !thread.members.includes(me) || thread.starter === me || thread.status !== "pending") return false;
  await kvSetJson(threadKey(id), { ...thread, status: "declined" }, DM_TTL_SECONDS);
  return true;
}

/** 이 사람이 이 대화에서 읽은 마지막 줄 번호 — 상대 화면의 "읽음" 표시에 씀. */
export async function readUpTo(account: string, id: string): Promise<number> {
  return (await kvGetJson<number>(readKey(account, id))) ?? 0;
}

export async function markRead(me: string, id: string, seq: number): Promise<void> {
  const have = (await kvGetJson<number>(readKey(me, id))) ?? 0;
  if (seq > have) await kvSetJson(readKey(me, id), seq, DM_TTL_SECONDS);
}

/** 이 대화에서 모두에게서 지운 줄 번호. */
export async function readGone(id: string): Promise<number[]> {
  return (await kvGetJson<number[]>(goneKey(id))) ?? [];
}

/** 지운 줄을 집은 인용은 글을 비운다(다른 줄 안에 남지 않게). 방에서 집은 인용은 그대로. */
export function withoutGone<T extends { seq: number; quote?: LineQuote }>(rows: T[], gone: number[]): T[] {
  if (!gone.length) return rows;
  const set = new Set(gone);
  return rows
    .filter((row) => !set.has(row.seq))
    .map((row) => (row.quote && !row.quote.roomId && set.has(row.quote.seq) ? { ...row, quote: { ...row.quote, text: "", focus: undefined } } : row));
}

export type UnsendResult = { ok: true; message: DmMessage } | { ok: false; error: "NOT_FOUND" | "NOT_YOURS" };

/**
 * 보낸 줄 지우기(2026-10-23, 사용자 "상대한테도 안 보이게"): 내 글·사진·통화 요청은 내가, 통화 기록은 둘 중 누구나.
 * 줄은 목록에서 바로 빼고(LREM), 번호는 gone에 남겨 이미 받아 둔 상대 앱도 지운다. 사진 파일은 부르는 쪽이 지운다.
 */
export async function unsend(me: string, id: string, seq: number): Promise<UnsendResult> {
  const thread = await readThread(id);
  if (!thread || !thread.members.includes(me)) return { ok: false, error: "NOT_FOUND" };
  const raws = await kvListRange(msgsKey(id), -DM_MAX_KEPT, -1);
  let raw: string | undefined;
  let message: DmMessage | undefined;
  for (const row of raws) {
    try {
      const parsed = JSON.parse(row) as DmMessage;
      if (parsed.seq === seq) {
        raw = row;
        message = parsed;
        break;
      }
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }
  if (!raw || !message) return { ok: false, error: "NOT_FOUND" };
  if (message.kind !== "callLog" && message.from !== me) return { ok: false, error: "NOT_YOURS" };
  await kvListRemove(msgsKey(id), raw);
  const gone = [...new Set([...(await readGone(id)), seq])].slice(-GONE_KEEP);
  await kvSetJson(goneKey(id), gone, DM_TTL_SECONDS);
  // 목록 미리보기: 남은 마지막 글로(없으면 비움).
  const lastText = parse(await kvListRange(msgsKey(id), -DM_MAX_KEPT, -1))
    .filter((row) => row.kind === "text")
    .at(-1);
  const preview = lastText ? (lastText.image ? (lastText.text ? `📷 ${lastText.text}` : "📷") : lastText.text) : "";
  // 그 사이 새 줄이 왔으면 그 줄이 미리보기이므로 건드리지 않는다.
  const fresh = await readThread(id);
  if (fresh && fresh.lastSeq === thread.lastSeq && fresh.lastText !== preview) {
    await kvSetJson(threadKey(id), { ...fresh, lastText: preview }, DM_TTL_SECONDS);
  }
  return { ok: true, message };
}

/** 이 대화에서 나에게 숨긴 마지막 번호(없으면 0). */
export async function hiddenUpTo(me: string, id: string): Promise<number> {
  return (await kvGetJson<number>(hideKey(me, id))) ?? 0;
}

/**
 * 내 목록에서 대화 지우기(2026-10-23, 사용자 "채팅창 삭제가 안 돼"). 상대 쪽은 그대로, 서버 기록은 원래대로 30일 뒤 만료.
 * 새 줄이 오면 목록에 다시 나오고, 지우기 전 줄은 나에게 안 보인다.
 */
export async function hideThread(me: string, id: string): Promise<boolean> {
  const thread = await readThread(id);
  if (!thread || !thread.members.includes(me)) return false;
  await kvSetJson(hideKey(me, id), thread.lastSeq ?? 0, DM_TTL_SECONDS);
  return true;
}

/** 내 대화 목록. 거절한 요청은 받은 쪽 목록에서 뺀다. 최근 순. */
export async function inbox(me: string): Promise<DmSummary[]> {
  const ids = [...new Set(await kvListRange(boxKey(me)))];
  const rows = await Promise.all(
    ids.map(async (id) => {
      const thread = await readThread(id);
      if (!thread || !thread.members.includes(me)) return null;
      if (thread.status === "declined" && thread.starter !== me) return null;
      const hidden = await hiddenUpTo(me, id);
      if (hidden && (thread.lastSeq ?? 0) <= hidden) return null;
      const read = (await kvGetJson<number>(readKey(me, id))) ?? 0;
      return {
        thread,
        other: otherOf(thread, me),
        // 정확한 수는 줄을 읽어야 알지만, 목록에는 마지막 번호 차이로 충분하다(내 줄도 번호를 쓰므로 근사).
        unread: thread.lastFrom === me ? 0 : Math.max(0, thread.lastSeq - read),
        request: thread.status === "pending" && thread.starter !== me,
      } satisfies DmSummary;
    }),
  );
  return rows.filter((row): row is DmSummary => row !== null).sort((a, b) => b.thread.lastAt - a.thread.lastAt);
}

/** 통화 기록은 방 하나에 한 번만(둘 다 끊어도). 처음 부른 쪽이 true. */
export async function claimCallLog(roomId: string): Promise<boolean> {
  return kvSetJsonIfAbsent(logKey(roomId), 1, DM_TTL_SECONDS);
}

/**
 * 집을 수 있는 줄 찾기: 글 메시지, 또는 통화 기록의 한 줄(index). 인용 글은 여기서 채운다.
 */
export async function findQuote(threadId: string, seq: number, index?: number): Promise<LineQuote | null> {
  const found = (await readMessages(threadId)).find((message) => message.seq === seq);
  if (!found) return null;
  if (found.kind === "text") return { seq, nickname: "", text: clipQuote(found.text), accountId: found.from };
  if (found.kind === "callLog" && typeof index === "number") {
    const line = found.lines?.[index];
    if (!line) return null;
    return { seq, index, nickname: line.nickname, text: clipQuote(line.text), accountId: line.from };
  }
  return null;
}
