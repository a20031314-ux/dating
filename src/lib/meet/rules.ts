/**
 * 지역 모임(번개) — 앱과 서버가 함께 쓰는 모양과 규칙. 가져오는 것은 데이팅 규칙의 지역·성별뿐.
 *
 * 모집글 하나에 단체방 하나(원본 server/groupStore.ts 그대로). 신청 → 방장 승인 → 단체방에 들어간다.
 * 목록에는 동네(area)까지만, 정확한 장소(place)는 승인된 사람에게만.
 * 비용은 정해진 보기만 — 금액·성별 조건은 받지 않는다(유료 만남 오해 방지, README "지역 모임").
 */
import { isGender, isRegion, type Gender, type Region } from "../dating/rules.ts";

export type MeetCost = "split" | "each" | "host";
export const MEET_COSTS: MeetCost[] = ["split", "each", "host"];
export const COST_LABEL: Record<MeetCost, string> = { split: "N빵", each: "각자 계산", host: "주최자가 냄" };

export function isMeetCost(value: unknown): value is MeetCost {
  return typeof value === "string" && (MEET_COSTS as string[]).includes(value);
}

/** 자리: 성별 무관 n명, 또는 남 n·여 n(방장 포함). */
export type MeetSeats = { kind: "any"; total: number } | { kind: "ratio"; m: number; f: number };

export const MEET_MIN_PEOPLE = 2;
export const MEET_MAX_PEOPLE = 10;
export const MEET_AREA_MAX = 20;
export const MEET_PLACE_MAX = 60;
export const MEET_NOTE_MAX = 200;
/** 모임 시각은 지금부터 이 안(번개라서 짧게). */
export const MEET_AHEAD_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const MEET_AHEAD_MIN_MS = 10 * 60 * 1000;
/** 모임 시각이 지나고 이만큼이면 목록에서 빠지고 신청을 닫는다. */
export const MEET_OPEN_AFTER_MS = 2 * 60 * 60 * 1000;
/** 한 사람이 동시에 열 수 있는 모임 수. */
export const MEET_HOST_MAX = 3;
/** 한 사람이 하루에 보내는 신청 수. */
export const MEET_APPLY_PER_DAY = 10;

export type Meetup = {
  id: string;
  host: string;
  /** 이 모임의 단체방(원본 groupStore). */
  groupId: string;
  region: Region;
  /** 목록에 보이는 동네, 예: "홍대입구". */
  area: string;
  /** 정확한 장소 — 승인된 사람만 본다. */
  place: string;
  /** 모임 시각(ms). */
  at: number;
  seats: MeetSeats;
  cost: MeetCost;
  note: string;
  createdAt: number;
  /** 방장이 모집을 닫음. */
  closed?: boolean;
};

export type ApplyState = "pending" | "approved" | "rejected";
export type Application = { account: string; gender: Gender; at: number; state: ApplyState };

/** 목록·자세히 보기에 나가는 모양. place는 승인된 사람(방장 포함)에게만 채운다. */
export type MeetView = {
  id: string;
  region: Region;
  area: string;
  place: string | null;
  at: number;
  seats: MeetSeats;
  /** 지금 들어온 사람(방장 포함) 성별 수. */
  filled: { m: number; f: number };
  cost: MeetCost;
  note: string;
  host: { id: string; nickname: string; age: number; photo: string | null };
  /** 보는 사람과의 관계. */
  me: "host" | "member" | "pending" | "rejected" | "none";
  open: boolean;
  groupId: string | null;
};

export function totalOf(seats: MeetSeats): number {
  return seats.kind === "any" ? seats.total : seats.m + seats.f;
}

/** 이 성별 자리가 남았나. filled는 지금 들어온 사람 수(방장 포함). */
export function seatLeft(seats: MeetSeats, filled: { m: number; f: number }, gender: Gender): boolean {
  if (seats.kind === "any") return filled.m + filled.f < seats.total;
  return filled[gender] < seats[gender];
}

export function isFull(seats: MeetSeats, filled: { m: number; f: number }): boolean {
  return filled.m + filled.f >= totalOf(seats);
}

/** 모집 중인가: 닫지 않았고, 모임 시각 + 여유가 안 지났고, 자리가 남음. */
export function isOpen(meet: Pick<Meetup, "closed" | "at" | "seats">, filled: { m: number; f: number }, now: number = Date.now()): boolean {
  return !meet.closed && now < meet.at + MEET_OPEN_AFTER_MS && !isFull(meet.seats, filled);
}

/**
 * 받지 않는 글: 금액(…원·만원), 유료 만남을 뜻하는 말. 화면에 이유를 말하지 않고 "이 내용은 올릴 수 없어요"만.
 * 단어 목록은 운영하며 늘린다.
 */
const BLOCKED = [/\d[\d,.\s]*(만|천)?\s*원/, /조건\s*만남/, /스폰/, /용돈/, /만남\s*비/, /페이\s*(드|줌|있)/];

export function hasBlockedText(text: string): boolean {
  const flat = text.normalize("NFC");
  return BLOCKED.some((pattern) => pattern.test(flat));
}

export type MeetInput = Omit<Meetup, "id" | "host" | "groupId" | "createdAt" | "closed">;
export type MeetInputError = "BAD_REGION" | "BAD_AREA" | "BAD_PLACE" | "BAD_TIME" | "BAD_SEATS" | "BAD_COST" | "BLOCKED_TEXT";

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** 앱이 보낸 모집글을 검사해 담는다. hostGender: 성비 자리일 때 방장 자리가 있어야 한다. */
export function cleanMeetInput(raw: Record<string, unknown>, hostGender: Gender, now: number = Date.now()): { ok: MeetInput } | { error: MeetInputError } {
  if (!isRegion(raw.region)) return { error: "BAD_REGION" };
  const area = clean(raw.area, MEET_AREA_MAX);
  if (!area) return { error: "BAD_AREA" };
  const place = clean(raw.place, MEET_PLACE_MAX);
  if (!place) return { error: "BAD_PLACE" };
  const at = typeof raw.at === "number" && Number.isFinite(raw.at) ? Math.round(raw.at) : NaN;
  if (!(at >= now + MEET_AHEAD_MIN_MS && at <= now + MEET_AHEAD_MAX_MS)) return { error: "BAD_TIME" };
  const seats = cleanSeats(raw.seats, hostGender);
  if (!seats) return { error: "BAD_SEATS" };
  if (!isMeetCost(raw.cost)) return { error: "BAD_COST" };
  const note = clean(raw.note, MEET_NOTE_MAX);
  if ([area, place, note].some(hasBlockedText)) return { error: "BLOCKED_TEXT" };
  return { ok: { region: raw.region, area, place, at, seats, cost: raw.cost, note } };
}

function cleanSeats(value: unknown, hostGender: Gender): MeetSeats | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const count = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : -1);
  if (row.kind === "any") {
    const total = count(row.total);
    return total >= MEET_MIN_PEOPLE && total <= MEET_MAX_PEOPLE ? { kind: "any", total } : null;
  }
  if (row.kind === "ratio") {
    const m = count(row.m);
    const f = count(row.f);
    if (m < 0 || f < 0 || m + f < MEET_MIN_PEOPLE || m + f > MEET_MAX_PEOPLE) return null;
    if ((hostGender === "m" ? m : f) < 1) return null;
    return { kind: "ratio", m, f };
  }
  return null;
}

export { isGender };
