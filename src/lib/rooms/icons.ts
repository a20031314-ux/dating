/**
 * 사용자가 만든 아이콘·짤 묶음(디시콘처럼) — 앱과 서버가 함께 쓰는 모양·한도(설계: hub/drafts/icons-2026-10-23.md).
 *
 * - 누구나(로그인, 가입 7일 뒤) 묶음을 만들고 아이콘을 올린다. 정지 그림·움직이는 그림(GIF·움직이는 WebP) 모두.
 * - 올릴 때 라이선스를 고르고 동의한다: CC BY 4.0(출처 표시) 또는 CC0(조건 없음). 묶음에는 만든 사람이 늘 따라간다.
 * - 올리자마자 공개(사용자 결정 2026-10-23). 대신 자동 검사(프레임 여러 장)·신고(저작권 포함)·운영자 내리기.
 * - 서버가 긴 쪽 ICON_MAX_SIDE로 줄여 WebP로 바꿔 저장한다(움직임 유지). 모두에게 공개라 오래 캐시해 보낸다.
 * - 판매(사용자 2026-10-24 "사용자 제작 아이콘은 선택적으로 포인트판매", 가격은 "선택이 아니라 입력"): 무료 또는
 *   ICON_PRICE_MIN~ICON_PRICE_MAX 포인트를 직접 넣는다. 판매 묶음은 라이선스 "app"(이 앱에서 산 사람만), /ops 승인 뒤 목록,
 *   만든 사람에게 ICON_CREATOR_SHARE를 포인트로. 내리거나 지우면 산 사람에게 돌려준다. 기본 묶음(Noto)은 늘 무료.
 *
 * 순수.
 */

/** 무료 묶음이 고르는 라이선스. 판매 묶음은 늘 "app". */
export const ICON_LICENSES = ["cc-by-4.0", "cc0"] as const;
export type IconLicense = (typeof ICON_LICENSES)[number] | "app";

export const ICON_LICENSE_URL: Record<(typeof ICON_LICENSES)[number], string> = {
  "cc-by-4.0": "https://creativecommons.org/licenses/by/4.0/",
  cc0: "https://creativecommons.org/publicdomain/zero/1.0/",
};

/** 편집기 "움직임": 정지 그림 한 장을 서버가 움직이는 WebP로(server/iconMotion.ts). */
export const ICON_MOTIONS = ["bounce", "shake", "pulse", "wobble"] as const;
export type IconMotion = (typeof ICON_MOTIONS)[number];
export function isIconMotion(value: unknown): value is IconMotion {
  return typeof value === "string" && (ICON_MOTIONS as readonly string[]).includes(value);
}

/** 판매 가격(포인트, 만든 사람이 직접 넣음). 0 = 무료. 최소 2P — 1P면 만든 사람 몫(70% 내림)이 0이라. 최대는 포인트 상점 묶음(30P) 값. */
export const ICON_PRICE_MIN = 2;
export const ICON_PRICE_MAX = 30;
export type IconPrice = number;
/** 만든 사람 몫(산 포인트 중). */
export const ICON_CREATOR_SHARE = 0.7;
/** 판매 상태: 신청 전·승인 기다림·승인·거절. 무료 묶음은 없음. */
export type IconSale = "draft" | "pending" | "approved" | "rejected";

export function isIconPrice(value: unknown): value is IconPrice {
  return typeof value === "number" && Number.isInteger(value) && (value === 0 || (value >= ICON_PRICE_MIN && value <= ICON_PRICE_MAX));
}
export function creatorCut(price: number): number {
  return Math.floor(price * ICON_CREATOR_SHARE);
}
/** 판매 묶음인지(가격이 있으면). */
export function isPaidPack(pack: Pick<IconPack, "price">): boolean {
  return (pack.price ?? 0) > 0;
}
/** 공개 목록에 뜰 수 있는지: 무료이거나 승인된 판매 묶음. */
export function isListedSale(pack: Pick<IconPack, "price" | "sale">): boolean {
  return !isPaidPack(pack) || pack.sale === "approved";
}
/** 이 사람이 보낼 수 있는지: 무료·내 묶음·산 묶음. */
export function canUsePack(pack: Pick<IconPack, "price" | "owner">, me: string, bought: boolean): boolean {
  return !isPaidPack(pack) || pack.owner === me || bought;
}

/** 저장하는 아이콘 긴 쪽(px). */
export const ICON_MAX_SIDE = 256;
/** 올리는 원본 한도(GIF가 커서 넉넉히). 서버에서 줄인 뒤의 한도는 ICON_STORED_MAX_BYTES. */
export const ICON_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const ICON_STORED_MAX_BYTES = 600 * 1024;
/** 움직이는 그림의 프레임 수 한도. */
export const ICON_MAX_FRAMES = 150;
export const ICONS_PER_PACK = 24;
export const PACKS_PER_ACCOUNT = 20;
/** 하루에 올릴 수 있는 아이콘 수(한 사람). */
export const ICON_UPLOADS_PER_DAY = 60;
/** 가입하고 이만큼 지나야 올릴 수 있다(새 계정으로 마구 올리기 막기). */
export const ICON_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 내가 받아 둔 묶음 수 한도. */
export const COLLECTION_MAX = 60;
export const PACK_NAME_MAX = 30;
export const ICON_PHRASE_MAX = 40;
export const ICON_PAGE = 20;
/** 🔥 많이 쓰는 묶음 표시(사용자 2026-10-25): 인기 순 위쪽 HOT_PACK_TOP개 중 쓰인 수가 HOT_PACK_MIN_USES 이상. 쓰인 수는 한 사람 하루 한 번. */
export const HOT_PACK_TOP = 10;
export const HOT_PACK_MIN_USES = 30;

export type IconItem = {
  id: string;
  w: number;
  h: number;
  animated: boolean;
  /** 아이콘에 붙인 학습 언어 한 마디(선택) — 보내면 같이 보인다. */
  phrase?: { lang: string; text: string };
};

export type IconPack = {
  id: string;
  owner: string;
  name: string;
  license: IconLicense;
  icons: IconItem[];
  createdAt: number;
  /** 운영자가 내렸으면(저작권 등) 목록·보내기·그림 모두 막힌다. */
  hidden?: boolean;
  /** 판매 가격(포인트, 없거나 0이면 무료)과 판매 상태. */
  price?: number;
  sale?: IconSale;
  /** 읽을 때 채움: 쓰인 수, 만든 사람 이름, 내가 받아 뒀는지, 내가 샀는지. */
  uses?: number;
  ownerName?: string;
  added?: boolean;
  bought?: boolean;
  /** 🔥 많이 쓰는 묶음(읽을 때 채움, HOT_PACK_*). */
  hot?: boolean;
};

/** 메시지·댓글에 붙는 아이콘(보낼 때 서버가 묶음에서 채움). */
export type IconRef = { pack: string; id: string; w: number; h: number; animated: boolean; phrase?: { lang: string; text: string } };

const PACK_ID = /^ip_[0-9a-z]{6,24}$/;
const ICON_ID = /^ic_[0-9a-z]{6,24}$/;

export function isPackId(value: unknown): value is string {
  return typeof value === "string" && PACK_ID.test(value);
}
export function isIconId(value: unknown): value is string {
  return typeof value === "string" && ICON_ID.test(value);
}
/** 무료 묶음을 만들 때 고를 수 있는 라이선스(판매 묶음의 "app"은 서버가 정한다). */
export function isIconLicense(value: unknown): value is (typeof ICON_LICENSES)[number] {
  return typeof value === "string" && (ICON_LICENSES as readonly string[]).includes(value);
}

function randomPart(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
export function newPackId(): string {
  return `ip_${randomPart()}`;
}
export function newIconId(): string {
  return `ic_${randomPart()}`;
}

/** 이름·한 마디 정리: 줄바꿈·제어 문자 빼고 앞뒤 공백 정리, 글자 수 자르기(자소 단위가 아니라 코드포인트 — 짧아서 충분). */
export function cleanShortText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, max).join("");
}

export function cleanPhrase(value: unknown): IconItem["phrase"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const text = cleanShortText(raw.text, ICON_PHRASE_MAX);
  const lang = typeof raw.lang === "string" && /^[a-z]{2}$/.test(raw.lang) ? raw.lang : null;
  return text && lang ? { lang, text } : undefined;
}

/** 묶음 안 아이콘 → 메시지에 붙는 모양. */
export function iconRefOf(pack: IconPack, iconId: string): IconRef | null {
  if (pack.hidden) return null;
  const icon = pack.icons.find((item) => item.id === iconId);
  if (!icon) return null;
  return { pack: pack.id, id: icon.id, w: icon.w, h: icon.h, animated: icon.animated, ...(icon.phrase ? { phrase: icon.phrase } : {}) };
}

/** 그림 주소(서버 경로). 앱은 apiUrl로 감싸 쓴다. */
export function iconPath(packId: string, iconId: string): string {
  return `/api/icons?f=${packId}.${iconId}`;
}
