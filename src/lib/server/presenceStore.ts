import { kvDelete, kvGetJson, kvGetJsonMany, kvSetJson, kvZAdd, kvZRem, kvZRevRange } from "./kv.ts";

/**
 * 누가 최근에 앱을 썼는지 — 사람 목록(말하는 방 → 사람)의 순서.
 *
 *   social:v1:active          계정 id → 마지막으로 본 시각(ms), 큰 것부터 읽는 정렬 모음
 *   social:v1:seen:<계정>     { at, learn, ui } 마지막으로 본 시각과 그때의 학습 언어·앱 언어
 *
 * 로그인한 사람만 들어간다. 언어는 프로필에 따로 묻지 않고 그 사람이 쓰는 앱 설정을
 * 그대로 쓴다(앱 언어 = 할 줄 아는 말, 학습 언어 = 배우는 말). 계정을 지우면 둘 다 지운다.
 *
 * 같은 사람이 짧은 간격으로 여러 번 불러도 쓰기는 1분에 한 번만(목록을 열 때마다,
 * 1분마다 부르므로).
 */

const ACTIVE_KEY = "social:v1:active";
const seenKey = (id: string) => `social:v1:seen:${id}`;
const SEEN_TTL_SECONDS = 60 * 24 * 60 * 60;
const WRITE_EVERY_MS = 60_000;

export type Presence = { at: number; learn: string | null; ui: string | null };

const LANG = /^[a-z]{2}$/;

function cleanLang(value: unknown): string | null {
  return typeof value === "string" && LANG.test(value) ? value : null;
}

/** 지금 이 사람이 앱을 쓰고 있다. 언어를 모르면 지난 값을 그대로 둔다. */
export async function touchPresence(
  id: string,
  langs: { learn?: unknown; ui?: unknown } = {},
  now: number = Date.now(),
): Promise<void> {
  const before = await kvGetJson<Presence>(seenKey(id));
  const learn = cleanLang(langs.learn) ?? before?.learn ?? null;
  const ui = cleanLang(langs.ui) ?? before?.ui ?? null;
  const same = before && before.learn === learn && before.ui === ui;
  if (same && now - before.at < WRITE_EVERY_MS) return;
  await kvSetJson(seenKey(id), { at: now, learn, ui } satisfies Presence, SEEN_TTL_SECONDS);
  await kvZAdd(ACTIVE_KEY, now, id);
}

export async function forgetPresence(id: string): Promise<void> {
  await kvZRem(ACTIVE_KEY, id);
  await kvDelete([seenKey(id)]);
}

/** 최근에 본 사람부터 `limit`명, `since` 이후만. */
export async function recentPeople(
  limit: number,
  since: number,
): Promise<{ id: string; presence: Presence }[]> {
  const rows = (await kvZRevRange(ACTIVE_KEY, 0, limit - 1)).filter((row) => row.score >= since);
  const seen = await kvGetJsonMany<Presence>(rows.map((row) => seenKey(row.member)));
  return rows.map((row, index) => ({
    id: row.member,
    presence: seen.at(index) ?? { at: row.score, learn: null, ui: null },
  }));
}

/** 한 사람의 마지막 사용 시각·언어. */
export async function readPresence(id: string): Promise<Presence | null> {
  return kvGetJson<Presence>(seenKey(id));
}
