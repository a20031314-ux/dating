/**
 * 계정·프로필에서 앱과 서버가 함께 쓰는 것: 모양, 한도, 입력 정리.
 *
 * 로그인은 선택이다. 로그인하지 않은 사람은 지금처럼 RevenueCat 익명 id로
 * 기록이 쌓이고, 로그인하면 서버가 그 기록을 계정에 묶어 다른 기기에서도
 * 같은 기록을 읽게 한다(server/accountStore.ts).
 *
 * 다른 모듈은 상대 경로로만 가져온다 — 테스트가 상대 경로만 풀기 때문.
 */
import type { ProfileFacts, ProfileShow } from "./profileFacts.ts";

/** 앱이 로그인 토큰을 실어 보내는 헤더. cors.ts의 허용 목록에도 있어야 한다. */
export const AUTH_TOKEN_HEADER = "x-auth-token";

export const NICKNAME_MAX = 20;
export const BIO_MAX = 200;
/** 사진은 앱에서 256px JPEG로 줄여 data URL로 보낸다. 그보다 크면 거절. */
export const PHOTO_MAX_BYTES = 120_000;
export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_SECONDS = 10 * 60;

/** 아이디: 영문 소문자·숫자·_·. 로 4~20자, 첫 글자는 영문·숫자. 대문자로 써도 소문자로 저장. */
export const USERNAME_MIN = 4;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
/** scrypt에 넣는 길이 한도 — 아주 긴 입력으로 서버를 붙잡지 못하게. */
export const PASSWORD_MAX = 128;

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return null;
  return /^[a-z0-9][a-z0-9_.]*$/.test(name) ? name : null;
}

export function isPasswordOk(value: unknown): value is string {
  return typeof value === "string" && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

export type AccountProfile = {
  nickname: string;
  bio: string;
  /** data:image/jpeg;base64,… 또는 없음. */
  photo: string | null;
  /** 사람 목록(말하는 방 → 사람)에서 나를 숨김. 기본은 보임. */
  hidden: boolean;
  /** 1:1·단체방 읽음 표시(기본 켬). 끄면 내 읽음도 안 알리고 남의 읽음도 안 봄. 예전 서버 응답에는 없을 수 있다. */
  readReceipts?: boolean;
  /** 나에 대한 사실(칩 id). 예전 서버 응답에는 없을 수 있다. */
  facts?: ProfileFacts;
  /** 프로필에 보일 칸 켬/끔. */
  show?: ProfileShow;
};

/** 앱에 보여 주는 계정. 내부 id·데이터 id는 내보내지 않는다. */
export type PublicAccount = {
  id: string;
  createdAt: string;
  email: string | null;
  google: boolean;
  /** 아이디·비밀번호로 로그인하는 계정이면 그 아이디. */
  username: string | null;
  profile: AccountProfile;
};

export type LoginResult = { token: string; account: PublicAccount; created: boolean };

export type AuthConfig = {
  /** Google 로그인 웹 클라이언트 ID. 없으면 Google 버튼을 숨긴다. */
  googleClientId: string | null;
  /** 메일 발송이 설정됐는지. 아니면 이메일 로그인을 숨긴다. */
  email: boolean;
  /** 아이디·비밀번호 로그인. 외부 설정이 필요 없어 서버가 켜져 있으면 늘 true. */
  password: boolean;
};

/** 글자 수는 화면에 보이는 글자(자소 묶음)로 센다 — 이모지·한글 조합이 한 글자. */
export function visibleLength(text: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length;
  }
  return Array.from(text).length;
}

function clipVisible(text: string, max: number): string {
  if (visibleLength(text) <= max) return text;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const parts: string[] = [];
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
      if (parts.length >= max) break;
      parts.push(segment);
    }
    return parts.join("");
  }
  return Array.from(text).slice(0, max).join("");
}

/** 제어 문자를 빼고, 닉네임은 한 줄로. 길면 자른다. */
export function cleanNickname(value: unknown): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clipVisible(flat, NICKNAME_MAX);
}

/** 자기소개는 줄바꿈을 두 줄까지 허용한다. */
export function cleanBio(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clipVisible(text, BIO_MAX);
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  // 넉넉한 검사: 메일이 실제로 가는지는 코드가 확인한다.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

/** data URL 사진이 JPEG/PNG/WebP이고 한도 안인지. 아니면 null. */
export function cleanPhoto(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > PHOTO_MAX_BYTES) return null;
  return value;
}

export function isEmailCode(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`).test(value);
}
