/**
 * 데이팅 프로필·조건 — 앱과 서버가 함께 쓰는 모양과 규칙. 가져오는 것 없음(테스트·서버·화면 공용).
 *
 * 계정(닉네임·자기소개·대표 사진)은 원본 계정 저장소(server/accountStore.ts) 그대로 쓰고,
 * 데이팅에만 필요한 것(성별·출생 연도·지역·찾는 조건·사진 여러 장)은 따로 둔다(server/datingStore.ts).
 */

export type Gender = "m" | "f";
export const GENDERS: Gender[] = ["m", "f"];

export function isGender(value: unknown): value is Gender {
  return value === "m" || value === "f";
}

/** 시·도 17곳. 화면 이름은 REGION_LABEL. */
export const REGIONS = [
  "seoul",
  "busan",
  "daegu",
  "incheon",
  "gwangju",
  "daejeon",
  "ulsan",
  "sejong",
  "gyeonggi",
  "gangwon",
  "chungbuk",
  "chungnam",
  "jeonbuk",
  "jeonnam",
  "gyeongbuk",
  "gyeongnam",
  "jeju",
] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABEL: Record<Region, string> = {
  seoul: "서울",
  busan: "부산",
  daegu: "대구",
  incheon: "인천",
  gwangju: "광주",
  daejeon: "대전",
  ulsan: "울산",
  sejong: "세종",
  gyeonggi: "경기",
  gangwon: "강원",
  chungbuk: "충북",
  chungnam: "충남",
  jeonbuk: "전북",
  jeonnam: "전남",
  gyeongbuk: "경북",
  gyeongnam: "경남",
  jeju: "제주",
};

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

/**
 * 성인 기준: 청소년보호법의 연 나이 — 올해 19세가 되는 해(출생 연도 + 19)부터.
 * 출생 연도는 사용자가 적은 값이라, 실제 확인은 본인인증(api/verify)이 맡는다.
 */
export const ADULT_AGE = 19;
export const AGE_MAX = 80;

/** 연 나이(올해 − 출생 연도). 프로필·조건에 쓰는 나이는 모두 이것. */
export function yearAge(birthYear: number, now: number = Date.now()): number {
  return new Date(now).getUTCFullYear() - birthYear;
}

export function isBirthYear(value: unknown, now: number = Date.now()): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  const age = yearAge(value, now);
  return age >= ADULT_AGE && age <= AGE_MAX;
}

export const PHOTOS_MAX = 6;
/** 사진 한 장(data URL) 최대 크기 — 앱이 줄여서 보낸다. 계정 대표 사진과 같은 한도. */
export const PHOTO_MAX_CHARS = 160_000;
/** 하루에 보낼 수 있는 좋아요 수(도배 막기). */
export const DAILY_LIKES = 50;
/** 한 번에 보여 주는 추천 카드 수. */
export const DISCOVER_BATCH = 20;

export type DatingWant = {
  /** 보고 싶은 성별(하나 이상). */
  genders: Gender[];
  ageMin: number;
  ageMax: number;
  /** 보고 싶은 지역. 비어 있으면 전국. */
  regions: Region[];
};

export type DatingProfile = {
  gender: Gender;
  birthYear: number;
  region: Region;
  want: DatingWant;
  /** 사진 버전 id, 앞이 대표 사진. 파일은 datingStore의 photo 키. */
  photos: string[];
  /** 끄면 추천에 안 나온다(이미 맺은 매칭·대화는 그대로). */
  visible: boolean;
  updatedAt: number;
};

/** 추천·매칭 목록에 보이는 한 사람. 이메일·아이디·출생 연도 원값은 내보내지 않는다. */
export type DatingCard = {
  id: string;
  nickname: string;
  age: number;
  region: Region;
  bio: string;
  photos: string[];
  /** 나에게 이미 좋아요를 보냈는지(받은 좋아요 목록에서만 true). */
  likedMe?: boolean;
};

export type MatchRow = {
  card: DatingCard;
  threadId: string;
  matchedAt: number;
};

/** 앱이 보낸 조건을 고쳐 담는다. 틀린 값은 기본값으로. */
export function cleanWant(value: unknown, mine?: Pick<DatingProfile, "gender">): DatingWant {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const genders = Array.isArray(raw.genders) ? [...new Set(raw.genders.filter(isGender))] : [];
  const fallbackGender: Gender[] = mine ? [mine.gender === "m" ? "f" : "m"] : [...GENDERS];
  const clampAge = (age: unknown, fallback: number) =>
    typeof age === "number" && Number.isFinite(age) ? Math.min(AGE_MAX, Math.max(ADULT_AGE, Math.round(age))) : fallback;
  let ageMin = clampAge(raw.ageMin, ADULT_AGE);
  let ageMax = clampAge(raw.ageMax, AGE_MAX);
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  const regions = Array.isArray(raw.regions) ? [...new Set(raw.regions.filter(isRegion))] : [];
  return { genders: genders.length ? genders : fallbackGender, ageMin, ageMax, regions };
}

/** a가 찾는 조건에 b가 맞나(한쪽만). */
export function wants(a: Pick<DatingProfile, "want">, b: Pick<DatingProfile, "gender" | "birthYear" | "region">, now: number = Date.now()): boolean {
  if (!a.want.genders.includes(b.gender)) return false;
  const age = yearAge(b.birthYear, now);
  if (age < a.want.ageMin || age > a.want.ageMax) return false;
  if (a.want.regions.length && !a.want.regions.includes(b.region)) return false;
  return true;
}

/** 서로의 조건에 맞나 — 추천에는 양쪽 다 맞는 사람만 나온다. */
export function mutualFit(a: DatingProfile, b: DatingProfile, now: number = Date.now()): boolean {
  return wants(a, b, now) && wants(b, a, now);
}

/** 추천 순서: 같은 지역 먼저, 그다음 최근 접속 순. */
export function discoverOrder(
  me: Pick<DatingProfile, "region">,
  rows: { id: string; profile: Pick<DatingProfile, "region">; activeAt: number }[],
): string[] {
  return [...rows]
    .sort((x, y) => {
      const sameX = x.profile.region === me.region ? 1 : 0;
      const sameY = y.profile.region === me.region ? 1 : 0;
      return sameY - sameX || y.activeAt - x.activeAt;
    })
    .map((row) => row.id);
}

/** 사진 data URL인지(jpeg·webp·png만, 크기 한도). */
export function isPhotoDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= PHOTO_MAX_CHARS &&
    /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

export function isPhotoVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{12}$/.test(value);
}
