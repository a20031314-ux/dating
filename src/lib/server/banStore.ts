/**
 * 운영자 이용 정지 — 원본(english-chat-mvp `server/opsStore.ts`)의 정지 부분만.
 *
 *   ops:v1:ban:<계정>   {at, until, note} — until이 null이면 풀 때까지
 *
 * 정지되면 좋아요·메시지·사진 올리기·랜덤 대화 같은 "쓰기"가 막힌다(suspension.ts).
 * 보기·신고·차단은 그대로. 운영자 화면(/ops)은 아직 없다 — 원본의 신고함을 옮겨 오면 된다.
 */
import { kvDelete, kvGetJson, kvSetJson } from "./kv.ts";

const banKey = (id: string) => `ops:v1:ban:${id}`;
/** 기한 없는 정지도 키는 3년(계정 삭제 때 지움). */
const BAN_FOREVER_SECONDS = 3 * 365 * 24 * 60 * 60;

export type Ban = { at: number; until: number | null; note: string };

export async function readBan(accountId: string, now: number = Date.now()): Promise<Ban | null> {
  const ban = await kvGetJson<Ban>(banKey(accountId));
  if (!ban) return null;
  return ban.until !== null && ban.until <= now ? null : ban;
}

export async function setBan(accountId: string, until: number | null, note: string, now: number = Date.now()): Promise<Ban> {
  const ban: Ban = { at: now, until, note: note.slice(0, 300) };
  const ttl = until === null ? BAN_FOREVER_SECONDS : Math.max(60, Math.ceil((until - now) / 1000));
  await kvSetJson(banKey(accountId), ban, ttl);
  return ban;
}

export async function liftBan(accountId: string): Promise<void> {
  await kvDelete([banKey(accountId)]);
}

export async function forgetBan(accountId: string): Promise<void> {
  await kvDelete([banKey(accountId)]);
}
