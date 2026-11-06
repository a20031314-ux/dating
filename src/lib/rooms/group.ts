/**
 * 단체방(워크스페이스 1단계) — 앱과 서버가 함께 쓰는 모양과 규칙.
 *
 * 초대로만 들어온다: 방장(만든 사람)이 팔로우한 사람 등을 초대하면 받는 사람에게
 * "초대 · 참여 / 거절"이 뜨고, 참여해야 대화를 읽고 쓴다. 모르는 사람이 남을 끌어들이지 못하게.
 * 줄은 1:1 메시지와 같은 모양(DmMessage)이라 번역·묻기·답하기를 같이 쓴다.
 * 마지막 활동으로부터 30일 보관(1:1 메시지와 같음).
 */

import type { DmMessage } from "./dm.ts";

export const GROUP_MAX_MEMBERS = 20;
export const GROUP_MAX_NAME_CHARS = 40;
export const GROUP_TTL_SECONDS = 30 * 24 * 60 * 60;
export const GROUP_MAX_KEPT = 500;
/** 팀은 마지막 활동 뒤 400일(사실상 "팀이 있는 동안"). */
export const TEAM_TTL_SECONDS = 400 * 24 * 60 * 60;
export const TEAM_GOAL_MAX_CHARS = 80;
export const SPACE_MAX_ITEMS = 300;
export const SPACE_TEXT_MAX_CHARS = 200;
export const SPACE_NOTE_MAX_CHARS = 200;

/** 이 단체방의 키를 얼마나 둘지. */
export function groupTtl(group: Pick<Group, "team">): number {
  return group.team ? TEAM_TTL_SECONDS : GROUP_TTL_SECONDS;
}

/**
 * 워크스페이스에 쌓이는 것.
 *   phrase  팀 대화에서 "무슨 뜻이에요?"로 물은 줄(text = 그 줄, from = 말한 사람, by = 물은 사람)
 *   session 팀 통화가 끝난 뒤 자막 기록(lines)
 *   share   누군가 직접 공유한 표현(text) + 메모(note)
 */
export type SpaceItem = {
  id: string;
  kind: "phrase" | "session" | "share";
  at: number;
  by: string;
  text: string;
  note?: string;
  from?: string | null;
  lines?: { from: string | null; nickname: string; text: string }[];
};

export type TeamSpace = { items: SpaceItem[]; days: string[] };

/** 서버 기준 날짜(UTC) "YYYY-MM-DD". */
export function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** 오늘(또는 어제)까지 이어진 같이 한 날 수. 오늘 아직 안 했어도 어제까지 이어졌으면 그 수. */
export function teamStreak(days: string[], now: number = Date.now()): number {
  const set = new Set(days);
  const step = 24 * 60 * 60 * 1000;
  let cursor = set.has(dayOf(now)) ? now : now - step;
  let count = 0;
  while (set.has(dayOf(cursor))) {
    count += 1;
    cursor -= step;
  }
  return count;
}

/** 최근 7일(오늘 포함) 중 같이 한 날 수. */
export function daysThisWeek(days: string[], now: number = Date.now()): number {
  const set = new Set(days);
  let count = 0;
  for (let i = 0; i < 7; i += 1) if (set.has(dayOf(now - i * 24 * 60 * 60 * 1000))) count += 1;
  return count;
}

/** 팀에서 나간 사람의 것을 뺀다: 그 사람이 공유·물은 것, 그 사람이 말한 줄, 통화 기록 속 그 사람 줄. */
export function withoutMember(items: SpaceItem[], account: string): SpaceItem[] {
  const out: SpaceItem[] = [];
  for (const item of items) {
    if (item.kind === "session") {
      const lines = (item.lines ?? []).filter((line) => line.from !== account);
      if (lines.length) out.push({ ...item, lines, text: String(lines.length), by: item.by === account ? "" : item.by });
      continue;
    }
    if (item.by === account || item.from === account) continue;
    out.push(item);
  }
  return out;
}

export function cleanSchedule(value: unknown): TeamSchedule | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { days?: unknown; time?: unknown; tz?: unknown };
  const days = Array.isArray(row.days)
    ? [...new Set(row.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];
  const time = typeof row.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.time) ? row.time : null;
  let tz = typeof row.tz === "string" ? row.tz.slice(0, 64) : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  return days.length && time ? { days, time, tz } : null;
}

export type Group = {
  id: string;
  name: string;
  /** 언어 조합(보통 둘) — 목록에 "영어 ↔ 한국어"처럼. */
  languages: string[];
  owner: string;
  members: string[];
  /** 초대했지만 아직 답하지 않은 계정. */
  invited: string[];
  /** 방장이 내보낸 계정 — 그 사람의 앱은 "내보내졌어요"를 띄운다(다시 초대하면 빠짐). */
  kicked?: string[];
  /** 지금(또는 마지막으로) 연 단체방 통화(비공개 말하는 방). */
  callRoomId?: string;
  createdAt: number;
  lastAt: number;
  lastText: string;
  lastFrom: string;
  lastSeq: number;
  /** 팀·러닝메이트로 올린 단체방(team.ts). 있으면 기록이 팀이 있는 동안 남는다. */
  team?: TeamInfo;
};

/**
 * 팀(3~20명) 또는 러닝메이트(둘). goal = 이번 주 목표 한 줄, schedule = 정기 모임
 * (요일 0=일…6=토, "HH:MM", 정한 사람의 시간대).
 */
export type TeamInfo = {
  kind: "team" | "mate";
  since: number;
  goal?: string;
  goalBy?: string;
  schedule?: TeamSchedule | null;
};

export type TeamSchedule = { days: number[]; time: string; tz: string };

/**
 * 단체방 줄: 글(text), 알림(system — text가 "join" | "leave" | "kick" | "host" | "call", from이 그 사람,
 * "call"이면 roomId), 끝난 통화의 자막 기록(callLog — lines).
 */
export type GroupMessage = Omit<DmMessage, "kind"> & { kind: "text" | "system" | "callLog" };

/** 단체방 통화 상태(열기·묻기 응답에 같이): 지금 들어와 있는 사람 수. */
export type GroupCall = { roomId: string; live: number } | null;

export type GroupSummary = {
  group: Group;
  unread: number;
  /** 나에게 온, 아직 답하지 않은 초대. */
  invite: boolean;
};

export function isGroupId(value: unknown): value is string {
  return typeof value === "string" && /^g_[a-z2-9]{10}$/.test(value);
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function newGroupId(random: () => number = Math.random): string {
  let id = "g_";
  for (let i = 0; i < 10; i += 1) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return id;
}

/** 한 번 더 초대할 수 있는지: 이미 있거나 초대 중이 아니고, 자리가 남아 있을 때. */
export function canInvite(group: Group, target: string): "ok" | "ALREADY" | "FULL" {
  if (group.members.includes(target) || group.invited.includes(target)) return "ALREADY";
  if (group.members.length + group.invited.length >= GROUP_MAX_MEMBERS) return "FULL";
  return "ok";
}

/**
 * 단체방 읽음: 내 가장 마지막 글 줄과, 다른 사람들이 읽은 줄 번호(reads) 중 그 줄까지 읽은 사람 수.
 * 아무도 안 읽었거나 내 글이 없으면 count 0.
 */
export function groupSeen(messages: Pick<GroupMessage, "seq" | "from" | "kind">[], me: string, reads: number[]): { seq: number; count: number } {
  let seq = 0;
  for (const message of messages) if (message.from === me && message.kind === "text" && message.seq > seq) seq = message.seq;
  if (!seq) return { seq: 0, count: 0 };
  return { seq, count: reads.filter((read) => read >= seq).length };
}
