/**
 * 공개 프로필에 붙는 "나에 대한 사실"과 "프로필에 보일 것"(설계: hub/drafts/profile-2026-10-23.md).
 *
 * 모두 고정 칩 id로만 저장한다 — 화면 이름은 앱의 틀 문구(14개 언어)가 맡고, 서버는 id만 본다.
 * 자유 글은 자기소개 하나뿐이다. 학습 상태(실수·약점·교정 비율·레벨·문장)는 여기에 없고,
 * 켜는 스위치도 만들지 않는다 — 남에게 해 준 것만 공개, 내 학습 상태는 숨김.
 *
 * 다른 모듈은 상대 경로로만 가져온다(account/shared.ts와 같은 이유 — 테스트가 상대 경로만 푼다). 순수.
 */
import { isCountryCode } from "./countries.ts";

/** 관심사 칩. 순서가 화면 순서. 새 칩은 끝에 더하고, 있던 id는 바꾸지 않는다(저장된 값). */
export const INTEREST_IDS = [
  "music",
  "travel",
  "games",
  "cooking",
  "sports",
  "movies",
  "dramas",
  "books",
  "tech",
  "fashion",
  "pets",
  "photo",
  "art",
  "anime",
  "kpop",
  "food",
  "nature",
  "fitness",
  "science",
  "business",
  "history",
  "languages",
  "cafe",
  "volunteering",
] as const;
export const WORK_IDS = ["student", "worker", "freelance", "break", "other"] as const;
export const MEET_MODES = ["text", "call", "video"] as const;
export const MEET_TIMES = ["morning", "day", "evening", "night"] as const;

export type InterestId = (typeof INTEREST_IDS)[number];
export type WorkId = (typeof WORK_IDS)[number];
export type MeetMode = (typeof MEET_MODES)[number];
export type MeetTime = (typeof MEET_TIMES)[number];

export const INTERESTS_MAX = 5;
/**
 * 할 수 있는 언어·배우는 언어는 사용자가 고르는 개수에 제한을 두지 않는다(사용자 결정 2026-10-23) —
 * 고를 수 있는 건 앱의 언어 목록뿐이라 이 값은 이상한 요청을 자르는 안전선일 뿐, 화면에 보이지 않는다.
 * (2.72 이하 앱은 할 수 있는 언어를 3개까지만 고르게 되어 있다.)
 */
export const LANGS_MAX = 20;

export type ProfileFacts = {
  /** 국적(ISO 3166-1 두 글자, 화면은 국기로). 안 정했으면 null. */
  country: string | null;
  /** 모국어(앱 언어와 따로). 모르면 null — 그때 화면은 예전처럼 앱 언어를 쓴다. */
  native: string | null;
  /** 할 수 있는 언어(수준 없음), 모국어 빼고. 개수 제한 없음(2026-10-23, 그 전 앱은 3개까지). */
  speaks: string[];
  /**
   * 배우는 언어(2026-10-23, 개수 제한 없음). 사람 목록·게시판·Room의 "같은 언어를 배우는 사람" 거르기가 쓴다.
   * 비어 있으면 그 사람이 마지막으로 앱에 둔 학습 언어(접속 기록)로 대신한다(`learnsOf`).
   */
  learns: string[];
  interests: InterestId[];
  work: WorkId | null;
  meetModes: MeetMode[];
  meetTimes: MeetTime[];
};

export const EMPTY_FACTS: ProfileFacts = {
  country: null,
  native: null,
  speaks: [],
  learns: [],
  interests: [],
  work: null,
  meetModes: [],
  meetTimes: [],
};

/**
 * 공개 프로필의 학습 칸과 튜터 사용, 칸마다 켬/끔. 처음 값은 남이 보고 말을 걸 이유가 되는
 * 칸(도움·꾸준함·목표·함께 만든 사람)은 켬, 내 학습 내용이 드러나는 칸(주제·표현)은 끔.
 * `tutor`는 공개 칸이 아니라 "튜터가 내 관심사를 대화 소재로 써도 되는지"(본인만 보는 스위치).
 */
export const SHOW_KEYS = ["help", "streak", "study", "goal", "maker", "posts", "follows", "topics", "phrases", "tutor"] as const;
export type ShowKey = (typeof SHOW_KEYS)[number];
export type ProfileShow = Record<ShowKey, boolean>;

export const DEFAULT_SHOW: ProfileShow = {
  help: true,
  streak: true,
  /** 공부 기록(통과한 대본·문장구조·말한 문장 수) — 남과 비교되기 싫을 수 있어 처음엔 끔(2026-10-28). */
  study: false,
  goal: true,
  maker: true,
  /** 게시판에 올린 글(이미 모두에게 보이는 글이라 처음엔 켬, 2026-10-23). */
  posts: true,
  /** 팔로워·팔로잉 목록을 다른 사람이 열어 볼 수 있음(숫자는 늘 보임, 2026-10-28 사용자 "조회 가능하되 숨길 수 있게"). */
  follows: true,
  topics: false,
  phrases: false,
  tutor: true,
};

const LANG = /^[a-z]{2}$/;

function pickIds<T extends string>(value: unknown, allowed: readonly T[], max: number): T[] {
  const out: T[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (out.length >= max) break;
    if (typeof entry === "string" && (allowed as readonly string[]).includes(entry) && !out.includes(entry as T)) {
      out.push(entry as T);
    }
  }
  return out;
}

function pickLangs(value: unknown, max: number, except: string | null): string[] {
  const out: string[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (out.length >= max) break;
    if (typeof entry === "string" && LANG.test(entry) && entry !== except && !out.includes(entry)) out.push(entry);
  }
  return out;
}

/** 앱이 보낸 사실을 정리한다. 모르는 칩·중복·한도를 넘는 것은 버린다(오류로 막지 않음). */
export function cleanFacts(value: unknown): ProfileFacts {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const native = typeof raw.native === "string" && LANG.test(raw.native) ? raw.native : null;
  const country = typeof raw.country === "string" ? raw.country.toUpperCase() : null;
  return {
    country: isCountryCode(country) ? country : null,
    native,
    speaks: pickLangs(raw.speaks, LANGS_MAX, native),
    learns: pickLangs(raw.learns, LANGS_MAX, native),
    interests: pickIds(raw.interests, INTEREST_IDS, INTERESTS_MAX),
    work: typeof raw.work === "string" && (WORK_IDS as readonly string[]).includes(raw.work) ? (raw.work as WorkId) : null,
    meetModes: pickIds(raw.meetModes, MEET_MODES, MEET_MODES.length),
    meetTimes: pickIds(raw.meetTimes, MEET_TIMES, MEET_TIMES.length),
  };
}

/**
 * 앱이 보낸 사실을 저장할 모양으로. 배우는 언어 칸이 없는 예전 앱(2.72 이하)이 저장해도
 * 이미 고른 배우는 언어는 그대로 남긴다.
 */
export function mergeFacts(value: unknown, stored: Partial<ProfileFacts> | undefined): ProfileFacts {
  const next = cleanFacts(value);
  const sent = value && typeof value === "object" && "learns" in (value as Record<string, unknown>);
  if (sent || !stored) return next;
  return { ...next, learns: factsOf(stored).learns.filter((code) => code !== next.native) };
}

/** 그 사람이 배우는 언어: 프로필에 고른 것, 없으면 접속 기록의 학습 언어. */
export function learnsOf(facts: Pick<ProfileFacts, "learns">, fallback: string | null | undefined): string[] {
  if (facts.learns.length) return facts.learns;
  return fallback ? [fallback] : [];
}

/** 그 사람이 쓰는 말: 모국어 + 할 수 있는 언어, 둘 다 없으면 접속 기록의 앱 언어. */
export function speaksOf(facts: Pick<ProfileFacts, "native" | "speaks">, fallback: string | null | undefined): string[] {
  const own = [facts.native, ...facts.speaks].filter((code): code is string => Boolean(code));
  if (own.length) return own;
  return fallback ? [fallback] : [];
}

/** 칸 켬/끔. 보낸 칸만 바꾸고 나머지는 지금 값(없으면 처음 값). */
export function cleanShow(value: unknown, current: Partial<ProfileShow> | undefined): ProfileShow {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SHOW, ...(current ?? {}) };
  for (const key of SHOW_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  }
  return out;
}

/** 저장된 값(예전 계정은 없음)을 읽는 쪽에서 쓰는 모양으로. */
export function factsOf(stored: Partial<ProfileFacts> | undefined): ProfileFacts {
  return stored ? cleanFacts(stored) : EMPTY_FACTS;
}

export function showOf(stored: Partial<ProfileShow> | undefined): ProfileShow {
  return cleanShow({}, stored);
}

/** 두 사람의 관심사 겹침 수(사람 목록 정렬·"겹치는 관심사 n"). */
export function sharedInterests(a: readonly string[], b: readonly string[]): number {
  const set = new Set(a);
  return b.filter((id) => set.has(id)).length;
}

/**
 * 튜터에게 붙이는 한 줄(영어, 모델이 읽음). 관심사·하는 일이 없거나 튜터 사용을 끄면 빈 문자열.
 * 묻거나 나열하지 말고 자연스러울 때 소재로만 — 학습 요약과 같은 "선생님이 되지 않는다" 원칙.
 * 칩 id만 넣는다(그대로 베낄 만한 예문을 넣지 않는다, hub/RULES.md).
 */
export function factsPrompt(facts: ProfileFacts, show: ProfileShow): string {
  if (!show.tutor) return "";
  const parts: string[] = [];
  if (facts.interests.length) parts.push(`interests: ${facts.interests.join(", ")}`);
  if (facts.work) parts.push(`occupation: ${facts.work}`);
  if (!parts.length) return "";
  return `About the learner (${parts.join("; ")}). Draw on these as conversation topics when it fits naturally; do not ask about them directly, list them, or mention that you know them.`;
}
