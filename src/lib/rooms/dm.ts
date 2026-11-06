/**
 * 1:1 메시지(시험 기능) — 앱과 서버가 함께 쓰는 모양과 규칙.
 *
 * 프로필에서 "메시지"를 누르면 두 사람 사이의 대화가 열린다(두 사람에 하나).
 * 처음 보낸 사람 쪽에서는 바로 대화지만, 받는 사람에게는 "요청"으로 간다.
 * 받는 사람이 답하면 대화가 열리고(수락), 그 전까지 보낸 사람은 몇 줄만 보낼 수 있다.
 * 열린 대화에서는 📞으로 둘만의 통화 방을 연다(api/rooms 비공개 방).
 *
 * 메시지는 상대가 읽어야 하므로 서버에 둔다 — 마지막 메시지로부터 30일.
 */

import type { LineQuote } from "./quote.ts";
import type { IconRef } from "./icons.ts";
import type { MediaRef } from "./media.ts";

/** 받는 사람이 답하기 전, 처음 보낸 사람이 보낼 수 있는 줄 수. */
export const DM_PENDING_LIMIT = 3;
export const DM_MAX_CHARS = 1000;
/** 서버가 들고 있는 한 대화의 줄 수. */
export const DM_MAX_KEPT = 500;
export const DM_TTL_SECONDS = 30 * 24 * 60 * 60;

export type DmStatus = "pending" | "open" | "declined";

export type DmThread = {
  id: string;
  /** 두 계정, 정렬된 순서. */
  members: [string, string];
  /** 처음 보낸 사람. */
  starter: string;
  status: DmStatus;
  createdAt: number;
  lastAt: number;
  lastText: string;
  lastFrom: string;
  lastSeq: number;
};

export type DmCallLine = { nickname: string; mine: boolean; text: string };

export type DmMessage = {
  seq: number;
  from: string;
  /** text: 글, call: 통화 요청(방 id), callLog: 끝난 통화의 자막 기록. */
  kind: "text" | "call" | "callLog";
  text: string;
  at: number;
  roomId?: string;
  /** callLog일 때 줄들(말한 사람의 계정 id로 누가 했는지). */
  lines?: { from: string | null; nickname: string; text: string }[];
  /** 집은 메시지(또는 통화 기록의 한 줄). 서버가 채움(rooms/quote.ts). */
  quote?: LineQuote;
  /** "이거 무슨 뜻이에요?" 질문. */
  ask?: boolean;
  /** 붙인 사진(rooms/media.ts) — 글은 비어 있을 수 있다. */
  image?: MediaRef;
  /** 보낸 아이콘(rooms/icons.ts, 서버가 묶음에서 채움) — 글은 비어 있을 수 있다. */
  icon?: IconRef;
};

/** 목록에 보여 줄 한 줄: 상대·마지막 말·안 읽은 수, 요청인지. */
export type DmSummary = {
  thread: DmThread;
  other: string;
  unread: number;
  /** 나에게 온, 아직 답하지 않은 요청. */
  request: boolean;
};

export function threadIdFor(a: string, b: string): string {
  return [a, b].sort().join("__");
}

export function isThreadId(value: unknown): value is string {
  return typeof value === "string" && /^lb_[0-9a-f]{24}__lb_[0-9a-f]{24}$/.test(value);
}

export function otherOf(thread: Pick<DmThread, "members">, me: string): string {
  return thread.members[0] === me ? thread.members[1] : thread.members[0];
}

export type SendDecision = "ok" | "PENDING_LIMIT" | "DECLINED";

/**
 * 이 사람이 지금 보낼 수 있나. 받는 사람의 첫 답이 대화를 연다(open으로 바꾸는 건 부르는 쪽).
 * `sentByStarter`는 처음 보낸 사람이 지금까지 보낸 줄 수.
 */
export function canSend(thread: DmThread | null, me: string, sentByStarter: number): SendDecision {
  if (!thread) return "ok";
  if (thread.status === "open") return "ok";
  if (thread.status === "declined") return thread.starter === me ? "DECLINED" : "ok";
  if (thread.starter !== me) return "ok";
  return sentByStarter >= DM_PENDING_LIMIT ? "PENDING_LIMIT" : "ok";
}

/** 상대가 읽은(seq ≤ peerRead) 내 글 메시지 중 가장 마지막 줄 번호 — 없으면 0. */
export function lastSeenMine(messages: Pick<DmMessage, "seq" | "from" | "kind">[], me: string, peerRead: number): number {
  let found = 0;
  for (const message of messages) {
    if (message.from === me && message.kind === "text" && message.seq <= peerRead && message.seq > found) found = message.seq;
  }
  return found;
}
