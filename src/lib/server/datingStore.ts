/**
 * 데이팅 저장소 (KV) — 새로 만든 부분. 저장 방식은 원본 커뮤니티 저장소들과 같다(kv.ts).
 *
 *   dating:v1:profile:<계정>        데이팅 프로필(lib/dating/rules.ts DatingProfile)
 *   dating:v1:photo:<계정>:<버전>   사진 data URL
 *   dating:v1:active                추천 후보 (정렬 집합, 점수 = 마지막 접속)
 *   dating:v1:like:<보낸>:<받은>    좋아요 {at} (90일)
 *   dating:v1:seen:<계정>           내가 좋아요·패스한 사람 (정렬 집합, 점수 = 시각) — 추천에서 뺌
 *   dating:v1:likedby:<계정>        나에게 좋아요한 사람 (정렬 집합)
 *   dating:v1:matches:<계정>        매칭된 사람 (정렬 집합, 점수 = 매칭 시각)
 *   dating:v1:likes:<계정>:<날짜>   그날 보낸 좋아요 수 (2일)
 *
 * 서로 좋아요하면 매칭 — 원본 1:1 메시지의 `openThreadDirect`(server/dmStore.ts)로 요청 단계 없이 대화가 열린다.
 */
import { randomBytes } from "node:crypto";
import { kvDelete, kvGetJson, kvGetJsonMany, kvGetNumber, kvIncrBy, kvSetJson, kvZAdd, kvZRem, kvZRevRange } from "./kv.ts";
import { hideThread, openThreadDirect } from "./dmStore.ts";
import { threadIdFor } from "../rooms/dm.ts";
import { DAILY_LIKES, PHOTOS_MAX, discoverOrder, mutualFit, type DatingProfile } from "../dating/rules.ts";

const profileKey = (id: string) => `dating:v1:profile:${id}`;
const photoKey = (id: string, version: string) => `dating:v1:photo:${id}:${version}`;
const ACTIVE_KEY = "dating:v1:active";
const likeKey = (from: string, to: string) => `dating:v1:like:${from}:${to}`;
const seenKey = (id: string) => `dating:v1:seen:${id}`;
const likedByKey = (id: string) => `dating:v1:likedby:${id}`;
const matchesKey = (id: string) => `dating:v1:matches:${id}`;
const dailyKey = (id: string, day: string) => `dating:v1:likes:${id}:${day}`;

const LIKE_TTL_SECONDS = 90 * 24 * 60 * 60;
/** 추천 후보로 훑는 최근 접속자 수. 사람이 많아지면 지역별 색인으로 나눈다(README 로드맵). */
const ACTIVE_SCAN = 400;
/** 이미 본 사람 목록에서 읽는 최대 수. */
const SEEN_SCAN = 3000;

export async function readDatingProfile(id: string): Promise<DatingProfile | null> {
  return kvGetJson<DatingProfile>(profileKey(id));
}

export async function readDatingProfiles(ids: string[]): Promise<(DatingProfile | null)[]> {
  if (!ids.length) return [];
  return kvGetJsonMany<DatingProfile>(ids.map(profileKey));
}

/** 저장하고, 보이기로 했으면 추천 후보에(아니면 뺌). */
export async function saveDatingProfile(id: string, profile: DatingProfile, now: number = Date.now()): Promise<DatingProfile> {
  const saved = { ...profile, updatedAt: now };
  await kvSetJson(profileKey(id), saved);
  if (saved.visible && saved.photos.length > 0) await kvZAdd(ACTIVE_KEY, now, id);
  else await kvZRem(ACTIVE_KEY, id);
  return saved;
}

/** 앱을 쓰는 중이라는 신호 — 추천 순서(최근 접속)를 앞으로. */
export async function touchActive(id: string, profile: DatingProfile | null, now: number = Date.now()): Promise<void> {
  if (profile?.visible && profile.photos.length > 0) await kvZAdd(ACTIVE_KEY, now, id);
}

// ── 사진 ─────────────────────────────────────────────────

export type PhotoResult = { ok: DatingProfile } | { error: "NO_PROFILE" | "FULL" | "NOT_FOUND" };

export async function addPhoto(id: string, dataUrl: string): Promise<PhotoResult> {
  const profile = await readDatingProfile(id);
  if (!profile) return { error: "NO_PROFILE" };
  if (profile.photos.length >= PHOTOS_MAX) return { error: "FULL" };
  const version = randomBytes(6).toString("hex");
  await kvSetJson(photoKey(id, version), { photo: dataUrl });
  return { ok: await saveDatingProfile(id, { ...profile, photos: [...profile.photos, version] }) };
}

export async function removePhoto(id: string, version: string): Promise<PhotoResult> {
  const profile = await readDatingProfile(id);
  if (!profile) return { error: "NO_PROFILE" };
  if (!profile.photos.includes(version)) return { error: "NOT_FOUND" };
  await kvDelete([photoKey(id, version)]);
  return { ok: await saveDatingProfile(id, { ...profile, photos: profile.photos.filter((v) => v !== version) }) };
}

/** 순서 바꾸기(앞이 대표 사진). 있는 사진만, 빠진 것은 뒤에 그대로. */
export async function reorderPhotos(id: string, order: string[]): Promise<PhotoResult> {
  const profile = await readDatingProfile(id);
  if (!profile) return { error: "NO_PROFILE" };
  const front = order.filter((v, i) => profile.photos.includes(v) && order.indexOf(v) === i);
  const rest = profile.photos.filter((v) => !front.includes(v));
  return { ok: await saveDatingProfile(id, { ...profile, photos: [...front, ...rest] }) };
}

export async function readPhoto(id: string, version: string): Promise<string | null> {
  const row = await kvGetJson<{ photo: string }>(photoKey(id, version));
  return row?.photo ?? null;
}

// ── 추천 ─────────────────────────────────────────────────

export async function readSeen(me: string): Promise<Set<string>> {
  const rows = await kvZRevRange(seenKey(me), 0, SEEN_SCAN - 1);
  return new Set(rows.map((row) => row.member));
}

/**
 * 추천 후보: 최근 접속자 중 나 아님 · 이미 본 사람 아님 · 차단 아님 · 서로 조건이 맞는 사람.
 * `blocked`·`allowed`는 부르는 쪽이 준다(차단은 socialStore, 성인인증은 randomStore).
 */
export async function discover(input: {
  me: string;
  profile: DatingProfile;
  limit: number;
  blocked: (other: string) => Promise<boolean>;
  allowed?: (other: string) => Promise<boolean>;
  now?: number;
}): Promise<string[]> {
  const now = input.now ?? Date.now();
  const [active, seen] = await Promise.all([kvZRevRange(ACTIVE_KEY, 0, ACTIVE_SCAN - 1), readSeen(input.me)]);
  const candidates = active.filter((row) => row.member !== input.me && !seen.has(row.member));
  const profiles = await readDatingProfiles(candidates.map((row) => row.member));
  const fits: { id: string; profile: DatingProfile; activeAt: number }[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const profile = profiles[i];
    if (!profile || !profile.visible || profile.photos.length === 0) continue;
    if (!mutualFit(input.profile, profile, now)) continue;
    fits.push({ id: candidates[i].member, profile, activeAt: candidates[i].score });
  }
  const ordered = discoverOrder(input.profile, fits);
  const out: string[] = [];
  for (const id of ordered) {
    if (out.length >= input.limit) break;
    if (await input.blocked(id)) continue;
    if (input.allowed && !(await input.allowed(id))) continue;
    out.push(id);
  }
  return out;
}

// ── 좋아요·패스·매칭 ──────────────────────────────────────

export type LikeResult =
  | { ok: true; matched: false }
  | { ok: true; matched: true; threadId: string }
  | { ok: false; error: "SELF" | "LIMIT" };

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** 오늘 남은 좋아요 수. */
export async function likesLeft(me: string, now: number = Date.now()): Promise<number> {
  const used = await kvGetNumber(dailyKey(me, today(now)));
  return Math.max(0, DAILY_LIKES - used);
}

/** 좋아요. 상대도 나를 좋아요했으면 그 자리에서 매칭 → 대화가 열린다. */
export async function like(me: string, target: string, now: number = Date.now()): Promise<LikeResult> {
  if (me === target) return { ok: false, error: "SELF" };
  const used = await kvIncrBy(dailyKey(me, today(now)), 1, 2 * 24 * 60 * 60);
  if (used > DAILY_LIKES) return { ok: false, error: "LIMIT" };
  await kvSetJson(likeKey(me, target), { at: now }, LIKE_TTL_SECONDS);
  await kvZAdd(seenKey(me), now, target);
  const theyLikedMe = await kvGetJson<{ at: number }>(likeKey(target, me));
  if (!theyLikedMe) {
    await kvZAdd(likedByKey(target), now, me);
    return { ok: true, matched: false };
  }
  await kvZAdd(matchesKey(me), now, target);
  await kvZAdd(matchesKey(target), now, me);
  await kvZRem(likedByKey(me), target);
  const thread = await openThreadDirect(me, target, now);
  return { ok: true, matched: true, threadId: thread.id };
}

/** 패스 — 추천에서 다시 안 나온다. 받은 좋아요 목록에서도 빠진다. */
export async function pass(me: string, target: string, now: number = Date.now()): Promise<void> {
  if (me === target) return;
  await kvZAdd(seenKey(me), now, target);
  await kvZRem(likedByKey(me), target);
}

/** 나에게 좋아요했고 내가 아직 답하지 않은 사람(최근 순). */
export async function likedMe(me: string, limit = 100): Promise<string[]> {
  const rows = await kvZRevRange(likedByKey(me), 0, limit - 1);
  return rows.map((row) => row.member);
}

export async function readMatches(me: string, limit = 200): Promise<{ id: string; at: number }[]> {
  const rows = await kvZRevRange(matchesKey(me), 0, limit - 1);
  return rows.map((row) => ({ id: row.member, at: row.score }));
}

export async function isMatched(a: string, b: string): Promise<boolean> {
  const rows = await kvZRevRange(matchesKey(a), 0, 999);
  return rows.some((row) => row.member === b);
}

/** 매칭 끊기: 둘 다의 목록에서 빼고, 내 대화 목록에서 그 대화를 숨긴다. 좋아요도 지워 다시 맞춰지지 않게. */
export async function unmatch(me: string, other: string): Promise<void> {
  await kvZRem(matchesKey(me), other);
  await kvZRem(matchesKey(other), me);
  await kvDelete([likeKey(me, other), likeKey(other, me)]);
  await kvZAdd(seenKey(me), Date.now(), other);
  await kvZAdd(seenKey(other), Date.now(), me);
  await hideThread(me, threadIdFor(me, other));
}

/** 계정을 지울 때: 프로필·사진·목록. 다른 사람 목록에 남은 이 계정은 읽을 때 걸러진다(계정 없음). */
export async function forgetDating(id: string): Promise<void> {
  const profile = await readDatingProfile(id);
  const keys = [profileKey(id), seenKey(id), likedByKey(id), matchesKey(id)];
  for (const version of profile?.photos ?? []) keys.push(photoKey(id, version));
  await kvDelete(keys);
  await kvZRem(ACTIVE_KEY, id);
}
