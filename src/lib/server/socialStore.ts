/**
 * 사람 사이의 관계: 팔로우·차단·신고, 그리고 공개 프로필에 붙는 숫자들.
 *
 *   social:v1:following:<계정>   내가 팔로우하는 계정 id 목록(JSON, 나만 씀)
 *   social:v1:block:<계정>       내가 차단한 계정 id 목록(JSON, 나만 씀)
 *   social:v1:edge:<나>:<상대>   팔로우 한 줄(있으면 1) — 팔로워 수를 두 번 세지 않게
 *   social:v1:followers:<계정>   팔로워 수(카운터)
 *   social:v1:followerset:<계정> 팔로워 목록(정렬된 집합, 점수 = 팔로우한 때 ms) — 2026-10-28부터, 그 전 팔로우는
 *                                `scripts/followers-backfill.mjs`(PC, KV 키)가 채움(점수 0)
 *   social:v1:hosted:<계정>      연 방 수(카운터)
 *   social:v1:helped:<계정>      손든 사람을 올려 준 횟수(카운터, 튜터 지표의 씨앗)
 *   social:v1:reports            신고 목록(운영자가 읽음, 90일)
 *
 * 목록은 그 주인만 쓰므로 읽고-고치고-쓰기가 다른 사람과 엉키지 않는다.
 * 팔로워는 여러 사람이 동시에 바꾸므로 목록 대신 카운터와 관계 줄로 센다.
 */
import { kvDelete, kvGetJson, kvGetJsonMany, kvGetNumber, kvIncrBy, kvListPush, kvListRange, kvSetJson, kvSetJsonIfAbsent, kvZAdd, kvZRem, kvZRevRange } from "./kv.ts";

const MAX_FOLLOWING = 500;
const MAX_BLOCKED = 500;
const REPORT_TTL_SECONDS = 90 * 24 * 60 * 60;

const followingKey = (id: string) => `social:v1:following:${id}`;
const blockKey = (id: string) => `social:v1:block:${id}`;
const edgeKey = (from: string, to: string) => `social:v1:edge:${from}:${to}`;
const followersKey = (id: string) => `social:v1:followers:${id}`;
export const followerSetKey = (id: string) => `social:v1:followerset:${id}`;
const hostedKey = (id: string) => `social:v1:hosted:${id}`;
const helpedKey = (id: string) => `social:v1:helped:${id}`;
const REPORTS_KEY = "social:v1:reports";

export function isAccountId(value: unknown): value is string {
  return typeof value === "string" && /^lb_[0-9a-f]{24}$/.test(value);
}

export async function readFollowing(id: string): Promise<string[]> {
  return (await kvGetJson<string[]>(followingKey(id))) ?? [];
}

export async function readBlocked(id: string): Promise<string[]> {
  return (await kvGetJson<string[]>(blockKey(id))) ?? [];
}

/** 여러 사람의 차단 목록을 한 번에(사람 목록에서 나를 차단한 사람 빼기). */
export async function readBlockedMany(ids: string[]): Promise<string[][]> {
  return (await kvGetJsonMany<string[]>(ids.map(blockKey))).map((list) => list ?? []);
}

/** a가 b를 차단했거나 b가 a를 차단했으면 true. */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const [mine, theirs] = await Promise.all([readBlocked(a), readBlocked(b)]);
  return mine.includes(b) || theirs.includes(a);
}

export type FollowResult = "ok" | "SELF" | "BLOCKED" | "LIMIT";

export async function follow(me: string, target: string): Promise<FollowResult> {
  if (me === target) return "SELF";
  if (await blockedEitherWay(me, target)) return "BLOCKED";
  const list = await readFollowing(me);
  if (!list.includes(target)) {
    if (list.length >= MAX_FOLLOWING) return "LIMIT";
    await kvSetJson(followingKey(me), [...list, target]);
  }
  // 관계 줄을 처음 만든 요청만 팔로워 수를 올린다(두 번 눌러도 한 번).
  if (await kvSetJsonIfAbsent(edgeKey(me, target), 1)) await kvIncrBy(followersKey(target), 1);
  // 팔로워 목록(여러 사람이 동시에 바꿔도 되는 정렬된 집합) — 다시 눌러도 같은 한 줄.
  await kvZAdd(followerSetKey(target), Date.now(), me);
  return "ok";
}

export async function unfollow(me: string, target: string): Promise<void> {
  const list = await readFollowing(me);
  if (list.includes(target)) await kvSetJson(followingKey(me), list.filter((id) => id !== target));
  if (await kvGetJson<number>(edgeKey(me, target))) {
    await kvDelete([edgeKey(me, target)]);
    await kvIncrBy(followersKey(target), -1);
  }
  await kvZRem(followerSetKey(target), me);
}

/** 팔로워 목록(최근 팔로우한 사람부터, 최대 limit명). 목록이 생기기 전 팔로우는 백필 전까지 빠질 수 있다. */
export async function readFollowers(id: string, limit = 200): Promise<string[]> {
  return (await kvZRevRange(followerSetKey(id), 0, limit - 1)).map((row) => row.member);
}

/** 팔로워 수(카운터). */
export async function followerCount(id: string): Promise<number> {
  return Math.max(0, await kvGetNumber(followersKey(id)));
}

/** 차단: 서로의 팔로우를 끊고, 내 목록에 넣는다. */
export async function block(me: string, target: string): Promise<"ok" | "SELF" | "LIMIT"> {
  if (me === target) return "SELF";
  const list = await readBlocked(me);
  if (!list.includes(target)) {
    if (list.length >= MAX_BLOCKED) return "LIMIT";
    await kvSetJson(blockKey(me), [...list, target]);
  }
  await unfollow(me, target);
  await unfollow(target, me);
  return "ok";
}

export async function unblock(me: string, target: string): Promise<void> {
  const list = await readBlocked(me);
  if (list.includes(target)) await kvSetJson(blockKey(me), list.filter((id) => id !== target));
}

export async function noteHosted(id: string): Promise<void> {
  await kvIncrBy(hostedKey(id), 1);
}

export async function noteHelped(id: string): Promise<void> {
  await kvIncrBy(helpedKey(id), 1);
}

export type SocialCounts = { followers: number; following: number; hosted: number; helped: number };

export async function counts(id: string): Promise<SocialCounts> {
  const [followers, following, hosted, helped] = await Promise.all([
    kvGetNumber(followersKey(id)),
    readFollowing(id),
    kvGetNumber(hostedKey(id)),
    kvGetNumber(helpedKey(id)),
  ]);
  return { followers: Math.max(0, followers), following: following.length, hosted, helped };
}

export type Report = {
  at: string;
  reporter: string;
  target: string;
  reason: string;
  roomId: string | null;
  /** 신고 순간 화면에 있던 그 사람의 최근 줄(최대 5). 판단 근거. */
  lines: string[];
};

export async function addReport(report: Report): Promise<void> {
  await kvListPush(REPORTS_KEY, [JSON.stringify(report)], REPORT_TTL_SECONDS);
}

/** 운영자 신고함(api/ops/reports)용: 최근 신고 원문 줄(JSON), 오래된 것부터. */
export async function readReportRows(limit = 500): Promise<string[]> {
  return kvListRange(REPORTS_KEY, -limit, -1);
}
