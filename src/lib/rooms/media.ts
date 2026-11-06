/**
 * 사람 사이 사진(1:1 메시지·단체방·게시판, 2026-10-20 사용자 결정) — 앱과 서버가 같이 쓰는 모양과 규칙.
 *
 * 흐름: 폰이 사진을 줄여(긴 쪽 MEDIA_MAX_SIDE, webp/jpeg) 올린다 → 서버가 자동 검사(성인·폭력·혐오 등 거절)
 * → 비공개 저장소(Vercel Blob, private)에 둔다 → 보낼 때 그 사진 id를 메시지·글에 붙인다(한 번만 쓸 수 있음).
 * 보는 사람은 서버(/api/media)를 거쳐서만 받는다: 1:1·단체방은 그 방 사람만, 게시판은 누구나.
 * 1:1·단체방 사진은 메시지처럼 30일 뒤 지워지고, 게시판 사진은 글·댓글·계정을 지울 때 같이 지운다.
 */

/** 메시지·글에 붙는 사진 하나. 크기는 자리 잡기용(사진이 오기 전에 칸 높이를 맞춘다). */
export type MediaRef = { id: string; w: number; h: number };

/** 어디에 붙일 사진인지. 1:1은 상대 계정, 단체방은 방 id, 게시판은 글 쓰기 전이라 따로 없음. */
export type MediaScope = { kind: "dm"; target: string } | { kind: "group"; id: string } | { kind: "board" };

/** 폰에서 줄이는 크기(긴 쪽 px)와 품질. */
export const MEDIA_MAX_SIDE = 1280;
export const MEDIA_QUALITY = 0.8;
/** 서버가 받는 한 장의 최대 크기(줄인 뒤). 이보다 크면 TOO_BIG. */
export const MEDIA_MAX_BYTES = 900 * 1024;
/** 하루에 올릴 수 있는 사진 수(사용자 결정 2026-10-20): 무료 10장, 유료 50장. */
export const MEDIA_DAILY_FREE = 10;
export const MEDIA_DAILY_PAID = 50;
/** 게시판 글 한 개에 붙이는 사진 수, 댓글·메시지는 1장. */
export const MEDIA_PER_POST = 4;
/** 1:1·단체방 사진의 보관(메시지와 같은 30일). */
export const MEDIA_CHAT_TTL_SECONDS = 30 * 24 * 60 * 60;
/** 올렸지만 보내지 않은 사진은 하루 뒤 지운다. */
export const MEDIA_UNSENT_TTL_SECONDS = 24 * 60 * 60;

export const MEDIA_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

const MEDIA_ID = /^m_[a-z0-9]{12,40}$/;
export function isMediaId(value: unknown): value is string {
  return typeof value === "string" && MEDIA_ID.test(value);
}

export function newMediaId(random: () => number = Math.random): string {
  let tail = "";
  for (let i = 0; i < 4; i += 1) tail += Math.floor(random() * 2 ** 32).toString(36).padStart(7, "0");
  return `m_${Date.now().toString(36)}${tail}`.slice(0, 40);
}

/** 오늘 올릴 수 있는 장수. */
export function mediaDailyLimit(paid: boolean): number {
  return paid ? MEDIA_DAILY_PAID : MEDIA_DAILY_FREE;
}

/** 줄인 크기(긴 쪽을 maxSide로, 작으면 그대로). */
export function fitSize(width: number, height: number, maxSide = MEDIA_MAX_SIDE): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxSide) return { w: Math.round(width), h: Math.round(height) };
  const ratio = maxSide / longest;
  return { w: Math.max(1, Math.round(width * ratio)), h: Math.max(1, Math.round(height * ratio)) };
}

/** 받은 MediaRef를 믿을 수 있는 모양으로(앱이 보낸 값은 서버가 다시 채운다). */
export function cleanMediaRef(value: unknown): MediaRef | null {
  const row = value as Partial<MediaRef> | null;
  if (!row || !isMediaId(row.id)) return null;
  const w = Number(row.w);
  const h = Number(row.h);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > 10_000 || h > 10_000) return null;
  return { id: row.id, w: Math.round(w), h: Math.round(h) };
}

/** 목록 미리보기 줄: 글이 없으면 사진 표시만. */
export function previewText(text: string, hasImage: boolean, photoLabel: string): string {
  if (text.trim()) return hasImage ? `📷 ${text}` : text;
  return hasImage ? `📷 ${photoLabel}` : "";
}
