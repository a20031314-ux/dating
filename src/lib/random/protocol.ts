/**
 * 랜덤 연결(창구 Spin, `hub/drafts/doors.md` "랜덤 창구") — 앱과 서버가 함께 쓰는 규칙.
 *
 * 법(여가부 고시 2020-12): 익명의 상대와 무작위 1:1 연결은 ①본인인증 ②대화 저장 ③신고가 모두 있어야 19금 지정에서 빠진다.
 * - ① 랜덤은 본인인증(포트원)으로 성인임을 확인한 계정만. 미성년·미인증은 랜덤만 막히고 다른 기능은 그대로.
 * - ② 랜덤으로 만난 두 사람은 1:1 대화가 바로 열리고(30일 보관, rooms/dm.ts), 영상통화 자막·채팅도 그 대화의 통화 기록에 남는다.
 * - ③ 프로필 시트의 신고·차단. 차단한 사람과는 다시 연결되지 않는다.
 * 스위치(`RANDOM_ENABLED`)가 꺼져 있으면 아무것도 연결하지 않는다. 법률 확인 전.
 */

export type RandomMode = "chat" | "video";

export function isRandomMode(value: unknown): value is RandomMode {
  return value === "chat" || value === "video";
}

/** 기다리는 사람이 이만큼 소식이 없으면(창을 닫음) 대기열에서 뺀다. 앱은 2초마다 묻는다. */
export const RANDOM_TICKET_STALE_MS = 15_000;
/** 같은 두 사람을 다시 잇지 않는 기간. */
export const RANDOM_REMATCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** 최근 만난 사람을 기억하는 수. */
export const RANDOM_MET_KEEP = 100;
/** 대기열에서 한 번에 살펴보는 사람 수. */
export const RANDOM_SCAN = 60;

/**
 * 청소년보호법의 청소년 = 만 19세 미만. 다만 만 19세가 되는 해의 1월 1일을 맞은 사람은 뺀다 →
 * (올해 − 태어난 해) ≥ 19면 성인. 한국 시간(UTC+9)의 올해로 센다.
 */
export function isAdultBirthDate(birthDate: string, now: number = Date.now()): boolean {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(birthDate.trim());
  if (!match) return false;
  const born = Number(match[1]);
  const thisYear = new Date(now + 9 * 60 * 60 * 1000).getUTCFullYear();
  return thisYear - born >= 19;
}

/** 대기열 한 사람: 배우는 말과 쓰는 말(앱 언어). */
export type RandomSide = { learn: string | null; ui: string | null };

/**
 * 언어가 맞는지: 한쪽의 배우는 말이 다른 쪽의 쓰는 말이면 맞음(언어 교환).
 * 2 = 서로 맞음(가장 좋음), 1 = 한쪽만, 0 = 안 맞음(잇지 않는다).
 */
export function languageFit(a: RandomSide, b: RandomSide): 0 | 1 | 2 {
  const ab = Boolean(a.learn && b.ui && a.learn === b.ui);
  const ba = Boolean(b.learn && a.ui && b.learn === a.ui);
  return ab && ba ? 2 : ab || ba ? 1 : 0;
}

/** 서버가 알려 주는 내 상태. */
export type RandomStatus =
  | { state: "off" }
  | { state: "signedOut" }
  /** kr = 포트원 휴대폰 본인인증(한국 번호), global = 해외용 나이 확인(업체 계약 뒤, 지금은 false). country = 접속 나라(Vercel). */
  | { state: "unverified"; verifyReady: boolean; globalReady: boolean; country: string | null }
  /** AI 영상 검사에 걸려 잠시 멈춤(이 시각까지). */
  | { state: "paused"; until: number }
  | { state: "minor" }
  | { state: "blocked" }
  | { state: "ready" };

/** 짝이 정해졌을 때: 상대·대화(늘)·영상이면 통화 방. */
export type RandomMatch = {
  mode: RandomMode;
  other: string;
  nickname: string;
  threadId: string;
  roomId?: string;
  at: number;
};

/** AI 영상 검사(랜덤 영상만): 앱이 몇 초마다 한 장. 내 화면(self)은 걸리면 내가 멈추고, 상대 화면(other)은 통화를 끝내고 신고만(누명을 막으려고 자동 정지 없음). */
export type FrameWho = "self" | "other";
export const RANDOM_FRAME_EVERY_MS = 3_000;
/** 내 화면이 걸리면 이만큼 랜덤을 멈춘다. */
export const RANDOM_PAUSE_MS = 24 * 60 * 60 * 1000;
/** 이 기간에 두 번 걸리면 랜덤을 영구히(본인 확인값 기준 — 새 계정도) 막는다. */
export const RANDOM_STRIKE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const RANDOM_STRIKES_TO_OFF = 2;
/** 검사에 보내는 한 장의 크기 상한(data URL 글자 수). */
export const RANDOM_FRAME_MAX_CHARS = 200_000;
