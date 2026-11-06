/**
 * 랜덤 연결 저장소(KV). 규칙은 lib/random/protocol.ts.
 *
 *   random:v1:adult:<계정>   성인인증 결과 {adult, at, ci} — 이름·번호·생년월일은 두지 않는다(ci는 해시)
 *   random:v1:ci:<ci해시>    그 사람이 인증에 쓴 계정(한 사람 한 계정 — 차단·신고를 새 계정으로 피하지 못하게)
 *   random:v1:iv:<인증번호>   이미 쓴 포트원 인증 번호(같은 인증을 두 계정에 못 씀)
 *   random:v1:ticket:<계정>  기다리는 중 {mode, learn, ui, at} — 15초 소식 없으면 빠짐
 *   random:v1:wait:<모드>    기다리는 계정 순서(RPUSH, 읽을 때 겹친 것·빠진 것 정리)
 *   random:v1:match:<계정>   정해진 짝(그 사람이 가져가면 지움)
 *   random:v1:met:<계정>     최근 만난 사람(24시간 안 다시 안 이음)
 *   random:v1:off:<ci해시>   막힌 사람(운영자가 손으로, 또는 AI 검사에 두 번 걸림)
 *   random:v1:pause:<계정>   AI 검사에 걸려 24시간 멈춤
 *   random:v1:strike:<계정>  AI 검사에 걸린 시각들(30일)
 *   random:v1:fr:<계정>      화면 검사 간격(3초에 한 번)
 */
import { createHash } from "node:crypto";
import {
  RANDOM_MET_KEEP,
  RANDOM_PAUSE_MS,
  RANDOM_STRIKES_TO_OFF,
  RANDOM_STRIKE_WINDOW_MS,
  RANDOM_REMATCH_COOLDOWN_MS,
  RANDOM_SCAN,
  RANDOM_TICKET_STALE_MS,
  isAdultBirthDate,
  languageFit,
  type RandomMatch,
  type RandomMode,
  type RandomSide,
} from "../random/protocol.ts";
import { purposeSecret } from "./authToken.ts";
import {
  kvDelete,
  kvGetJson,
  kvGetJsonMany,
  kvListPush,
  kvListRange,
  kvListTrim,
  kvSetJson,
  kvSetJsonIfAbsent,
} from "./kv.ts";

const adultKey = (id: string) => `random:v1:adult:${id}`;
const ciKey = (hash: string) => `random:v1:ci:${hash}`;
const ivKey = (id: string) => `random:v1:iv:${id}`;
const ticketKey = (id: string) => `random:v1:ticket:${id}`;
const waitKey = (mode: RandomMode) => `random:v1:wait:${mode}`;
const matchKey = (id: string) => `random:v1:match:${id}`;
const metKey = (id: string) => `random:v1:met:${id}`;
const offKey = (hash: string) => `random:v1:off:${hash}`;
const pauseKey = (id: string) => `random:v1:pause:${id}`;
const strikeKey = (id: string) => `random:v1:strike:${id}`;
const frameKey = (id: string) => `random:v1:fr:${id}`;

/** 성인인증은 다시 받지 않는다(계정이 있는 동안). 키 수명은 길게 두고 계정 삭제 때 지운다. */
const ADULT_TTL_SECONDS = 3 * 365 * 24 * 60 * 60;
const MATCH_TTL_SECONDS = 120;
const WAIT_KEEP = 400;

export type AdultRecord = { adult: boolean; at: number; ci: string | null; foreigner?: boolean; offBy?: "strikes" | "operator"; adultBefore?: boolean };
type Ticket = { mode: RandomMode; learn: string | null; ui: string | null; at: number };

/** 스위치: Vercel `RANDOM_ENABLED=1`일 때만 랜덤이 돈다(성인인증 계약·법률 확인 뒤). */
export function randomEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RANDOM_ENABLED?.trim() === "1";
}

/** ci는 그대로 두지 않고 서버 비밀로 섞은 해시로만(다른 서비스 기록과 맞춰 볼 수 없게). */
export function hashCi(ci: string): string {
  const key = purposeSecret("randomCi") ?? "dev";
  return createHash("sha256").update(`${key}:${ci}`).digest("hex").slice(0, 40);
}

export async function readAdult(accountId: string): Promise<AdultRecord | null> {
  return kvGetJson<AdultRecord>(adultKey(accountId));
}

export type VerifiedPerson = { birthDate: string; ci: string | null; foreigner?: boolean };

export type AdultResult = "adult" | "minor" | "USED" | "CI_TAKEN" | "OFF";

/**
 * 포트원에서 확인한 본인인증 결과를 계정에 붙인다. 같은 인증 번호는 한 번만,
 * 같은 사람(ci)은 한 계정만. 미성년이면 그 결과도 남겨 랜덤을 막는다.
 */
export async function recordAdult(
  accountId: string,
  verificationId: string,
  person: VerifiedPerson,
  now: number = Date.now(),
): Promise<AdultResult> {
  if (!(await kvSetJsonIfAbsent(ivKey(verificationId), accountId, ADULT_TTL_SECONDS))) {
    const usedBy = await kvGetJson<string>(ivKey(verificationId));
    if (usedBy !== accountId) return "USED";
  }
  const ci = person.ci ? hashCi(person.ci) : null;
  if (ci) {
    if (await kvGetJson<number>(offKey(ci))) return "OFF";
    const claimed = await kvSetJsonIfAbsent(ciKey(ci), accountId, ADULT_TTL_SECONDS);
    if (!claimed && (await kvGetJson<string>(ciKey(ci))) !== accountId) return "CI_TAKEN";
  }
  const adult = isAdultBirthDate(person.birthDate, now);
  await kvSetJson(adultKey(accountId), { adult, at: now, ci, ...(person.foreigner ? { foreigner: true } : {}) }, ADULT_TTL_SECONDS);
  return adult ? "adult" : "minor";
}

/** 운영자가 막았는지(ci 기준 — 새 계정으로 다시 인증해도 막힘). */
export async function isOff(record: AdultRecord | null): Promise<boolean> {
  return Boolean(record?.ci && (await kvGetJson<number>(offKey(record.ci))));
}

// ── AI 영상 검사 ─────────────────────────────────────────────

/** 지금 멈춘 중이면 풀리는 시각. */
export async function pausedUntil(accountId: string, now: number = Date.now()): Promise<number | null> {
  const until = await kvGetJson<number>(pauseKey(accountId));
  return until && until > now ? until : null;
}

/** 화면 검사는 한 사람 3초에 한 번(더 자주 오면 건너뜀). */
export async function takeFrameTurn(accountId: string): Promise<boolean> {
  return kvSetJsonIfAbsent(frameKey(accountId), 1, 3);
}

export type StrikeResult = { pausedUntil: number; off: boolean };

/**
 * 내 화면이 걸림: 24시간 멈춤, 30일 안 두 번째면 본인 확인값(ci) 기준으로 랜덤을 막는다(새 계정도).
 * ci가 없으면(인증 업체가 안 줌) 그 계정만 막는다.
 */
export async function recordStrike(accountId: string, now: number = Date.now()): Promise<StrikeResult> {
  const strikes = ((await kvGetJson<number[]>(strikeKey(accountId))) ?? []).filter((at) => now - at < RANDOM_STRIKE_WINDOW_MS);
  strikes.push(now);
  await kvSetJson(strikeKey(accountId), strikes, Math.ceil(RANDOM_STRIKE_WINDOW_MS / 1000));
  const until = now + RANDOM_PAUSE_MS;
  await kvSetJson(pauseKey(accountId), until, Math.ceil(RANDOM_PAUSE_MS / 1000));
  await leaveQueue(accountId);
  if (strikes.length < RANDOM_STRIKES_TO_OFF) return { pausedUntil: until, off: false };
  const record = await readAdult(accountId);
  if (record?.ci) await kvSetJson(offKey(record.ci), now, ADULT_TTL_SECONDS);
  else if (record) await kvSetJson(adultKey(accountId), { ...record, adult: false, offBy: "strikes", adultBefore: record.adult }, ADULT_TTL_SECONDS);
  return { pausedUntil: until, off: true };
}

// ── 운영자(신고함 /ops, api/ops/reports) ─────────────────────

export type RandomOpsView = {
  verified: boolean;
  adult: boolean;
  foreigner: boolean;
  pausedUntil: number | null;
  strikes: number;
  off: boolean;
};

export async function randomOpsView(accountId: string, now: number = Date.now()): Promise<RandomOpsView> {
  const [record, until, strikes] = await Promise.all([
    readAdult(accountId),
    pausedUntil(accountId, now),
    kvGetJson<number[]>(strikeKey(accountId)),
  ]);
  return {
    verified: Boolean(record),
    adult: Boolean(record?.adult || record?.adultBefore),
    foreigner: Boolean(record?.foreigner),
    pausedUntil: until,
    strikes: (strikes ?? []).filter((at) => now - at < RANDOM_STRIKE_WINDOW_MS).length,
    off: Boolean(record?.offBy) || (await isOff(record)),
  };
}

/** 운영자가 랜덤만 잠시 멈춤(시간) 또는 풀기(null — 걸린 기록도 지움). */
export async function setRandomPause(accountId: string, until: number | null, now: number = Date.now()): Promise<void> {
  if (until === null || until <= now) {
    await kvDelete([pauseKey(accountId), strikeKey(accountId)]);
    return;
  }
  await kvSetJson(pauseKey(accountId), until, Math.ceil((until - now) / 1000));
  await leaveQueue(accountId);
}

/**
 * 운영자가 랜덤을 막음/풀기. 본인 확인값(ci)이 있으면 그 사람 기준(새 계정도 막힘), 없으면 그 계정만.
 * 풀 때는 AI 검사로 막힌 것까지 같이 푼다.
 */
export async function setRandomOff(accountId: string, off: boolean, now: number = Date.now()): Promise<"ok" | "UNVERIFIED"> {
  const record = await readAdult(accountId);
  if (!record) return "UNVERIFIED";
  if (off) {
    if (record.ci) await kvSetJson(offKey(record.ci), now, ADULT_TTL_SECONDS);
    else if (!record.offBy) await kvSetJson(adultKey(accountId), { ...record, adult: false, offBy: "operator", adultBefore: record.adult }, ADULT_TTL_SECONDS);
    await leaveQueue(accountId);
    return "ok";
  }
  if (record.ci) await kvDelete([offKey(record.ci)]);
  if (record.offBy) {
    const { offBy: _offBy, adultBefore, ...rest } = record;
    await kvSetJson(adultKey(accountId), { ...rest, adult: adultBefore ?? true }, ADULT_TTL_SECONDS);
  }
  await kvDelete([strikeKey(accountId)]);
  return "ok";
}

// ── 대기열·짝 맞추기 ─────────────────────────────────────────

export type Partner = { id: string; side: RandomSide };

export type JoinInput = {
  me: string;
  mode: RandomMode;
  side: RandomSide;
  now?: number;
  /** 둘 사이를 막는지(차단). 서버 라우트가 socialStore로 넘긴다. */
  blocked: (other: string) => Promise<boolean>;
  /** 짝이 정해지면 대화(와 영상 방)를 만든다 — 라우트가 dmStore·roomStore로. */
  connect: (a: Partner, b: Partner, mode: RandomMode) => Promise<{ threadId: string; roomId?: string; names: Record<string, string> }>;
};

/**
 * 기다리기 시작하거나 계속 기다린다(앱이 2초마다 부름). 이미 누가 나를 골랐으면 그 짝을,
 * 아니면 대기열에서 언어가 맞는 사람을 찾아 바로 잇고, 없으면 내 표를 새로 걸어 둔다.
 */
export async function joinOrPoll(input: JoinInput): Promise<RandomMatch | null> {
  const now = input.now ?? Date.now();
  const mine = await kvGetJson<RandomMatch>(matchKey(input.me));
  if (mine) {
    await kvDelete([matchKey(input.me), ticketKey(input.me)]);
    return mine;
  }

  const waiting = await kvListRange(waitKey(input.mode), -RANDOM_SCAN * 2, -1);
  const ids = [...new Set(waiting)].filter((id) => id !== input.me);
  const tickets = ids.length ? await kvGetJsonMany<Ticket>(ids.map(ticketKey)) : [];
  const met = new Set(
    ((await kvGetJson<{ id: string; at: number }[]>(metKey(input.me))) ?? [])
      .filter((row) => now - row.at < RANDOM_REMATCH_COOLDOWN_MS)
      .map((row) => row.id),
  );

  // 오래 기다린 사람 먼저, 그중 서로 맞는 사람을 더 먼저.
  const candidates = ids
    .map((id, index) => ({ id, ticket: tickets[index] }))
    .filter((row): row is { id: string; ticket: Ticket } =>
      Boolean(row.ticket && row.ticket.mode === input.mode && now - row.ticket.at < RANDOM_TICKET_STALE_MS),
    )
    .filter((row) => !met.has(row.id))
    .map((row) => ({ ...row, fit: languageFit(input.side, row.ticket) }))
    .filter((row) => row.fit > 0)
    .sort((a, b) => b.fit - a.fit || a.ticket.at - b.ticket.at)
    .slice(0, RANDOM_SCAN);

  for (const candidate of candidates) {
    if (await input.blocked(candidate.id)) continue;
    // 두 사람의 짝 자리를 차례로 잡는다 — 둘 중 하나라도 이미 잡혔으면 물러난다(동시에 둘을 고르지 않게).
    const hold = { holding: true, at: now };
    if (!(await kvSetJsonIfAbsent(matchKey(input.me), hold, 10))) {
      const taken = await kvGetJson<RandomMatch & { holding?: boolean }>(matchKey(input.me));
      if (taken && !taken.holding) {
        await kvDelete([matchKey(input.me), ticketKey(input.me)]);
        return taken;
      }
      return null;
    }
    if (!(await kvSetJsonIfAbsent(matchKey(candidate.id), hold, 10))) {
      await kvDelete([matchKey(input.me)]);
      continue;
    }
    const made = await input.connect(
      { id: input.me, side: input.side },
      { id: candidate.id, side: { learn: candidate.ticket.learn, ui: candidate.ticket.ui } },
      input.mode,
    );
    const forMe: RandomMatch = { mode: input.mode, other: candidate.id, nickname: made.names[candidate.id] ?? "", threadId: made.threadId, ...(made.roomId ? { roomId: made.roomId } : {}), at: now };
    const forThem: RandomMatch = { ...forMe, other: input.me, nickname: made.names[input.me] ?? "" };
    await kvSetJson(matchKey(candidate.id), forThem, MATCH_TTL_SECONDS);
    await kvDelete([matchKey(input.me), ticketKey(input.me), ticketKey(candidate.id)]);
    await noteMet(input.me, candidate.id, now);
    await noteMet(candidate.id, input.me, now);
    return forMe;
  }

  // 아무도 없으면 내 표를 걸고 줄에 선다(이미 서 있으면 시각만 새로).
  const had = await kvGetJson<Ticket>(ticketKey(input.me));
  await kvSetJson(ticketKey(input.me), { mode: input.mode, learn: input.side.learn, ui: input.side.ui, at: now }, Math.ceil(RANDOM_TICKET_STALE_MS / 1000) + 5);
  if (!had || had.mode !== input.mode) {
    await kvListPush(waitKey(input.mode), [input.me], 60 * 60);
    await kvListTrim(waitKey(input.mode), WAIT_KEEP);
  }
  return null;
}

/** 그만 찾기(창을 닫거나 "그만"). 줄의 이름은 표가 없으면 다음 사람이 건너뛴다. */
export async function leaveQueue(me: string): Promise<void> {
  await kvDelete([ticketKey(me)]);
}

async function noteMet(me: string, other: string, now: number): Promise<void> {
  const rows = ((await kvGetJson<{ id: string; at: number }[]>(metKey(me))) ?? []).filter(
    (row) => row.id !== other && now - row.at < RANDOM_REMATCH_COOLDOWN_MS,
  );
  rows.push({ id: other, at: now });
  await kvSetJson(metKey(me), rows.slice(-RANDOM_MET_KEEP), Math.ceil(RANDOM_REMATCH_COOLDOWN_MS / 1000));
}

/** 계정을 지울 때: 성인인증 기록·대기·짝·만난 사람. ci 자리는 남겨 둔다(막힌 사람이 새 계정으로 못 돌아오게 — 막히지 않았으면 지움). */
export async function forgetRandom(accountId: string): Promise<void> {
  const record = await readAdult(accountId);
  const keys = [adultKey(accountId), ticketKey(accountId), matchKey(accountId), metKey(accountId), pauseKey(accountId), strikeKey(accountId), frameKey(accountId)];
  if (record?.ci && !(await kvGetJson<number>(offKey(record.ci)))) keys.push(ciKey(record.ci));
  await kvDelete(keys);
}
