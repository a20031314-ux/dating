/**
 * 지역 모임 저장소 (KV) — 새로 만든 부분. 채팅은 원본 단체방(server/groupStore.ts)을 그대로 쓴다.
 *
 *   meet:v1:m:<모임>              모집글(lib/meet/rules.ts Meetup)
 *   meet:v1:apps:<모임>           신청 목록(Application[])
 *   meet:v1:region:<지역>         그 지역 모임(정렬 집합, 점수 = 모임 시각)
 *   meet:v1:host:<계정>           내가 연 모임(정렬 집합, 점수 = 모임 시각)
 *   meet:v1:mine:<계정>           내가 신청한 모임(정렬 집합, 점수 = 모임 시각)
 *   meet:v1:applies:<계정>:<날짜> 그날 보낸 신청 수(2일)
 *   meet:v1:lock:<모임>           승인·신청을 한 줄로 세우는 잠금(5초)
 *
 * 모집글·신청은 모임 시각으로부터 30일 뒤 사라진다. 단체방 채팅은 원본대로 마지막 말로부터 30일.
 * 승인 = 방장이 단체방에 초대 → 신청자가 바로 참여(원본 inviteToGroup + answerInvite).
 */
import { kvDelete, kvGetJson, kvGetNumber, kvIncrBy, kvSetJson, kvSetJsonIfAbsent, kvZAdd, kvZRem, kvZRevRange } from "./kv.ts";
import { answerInvite, createGroup, inviteToGroup, kickFromGroup, leaveGroup, readGroup } from "./groupStore.ts";
import { readDatingProfiles } from "./datingStore.ts";
import {
  MEET_APPLY_PER_DAY,
  MEET_HOST_MAX,
  MEET_OPEN_AFTER_MS,
  isOpen,
  seatLeft,
  type Application,
  type MeetInput,
  type Meetup,
} from "../meet/rules.ts";
import type { Gender, Region } from "../dating/rules.ts";

const meetKey = (id: string) => `meet:v1:m:${id}`;
const appsKey = (id: string) => `meet:v1:apps:${id}`;
const regionKey = (region: string) => `meet:v1:region:${region}`;
const hostKey = (account: string) => `meet:v1:host:${account}`;
const mineKey = (account: string) => `meet:v1:mine:${account}`;
const appliesKey = (account: string, day: string) => `meet:v1:applies:${account}:${day}`;
const lockKey = (id: string) => `meet:v1:lock:${id}`;

const KEEP_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const ttlFor = (at: number, now: number) => Math.max(60, Math.ceil((at + KEEP_AFTER_MS - now) / 1000));

/** 같은 모임의 신청·승인이 서로 덮어쓰지 않게(원본 groupStore.withGroupLock과 같은 방식). */
async function withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const token = `${Date.now()}-${Math.random()}`;
  let held = false;
  for (let tries = 0; tries < 60 && !held; tries += 1) {
    held = await kvSetJsonIfAbsent(lockKey(id), token, 5);
    if (!held) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    return await work();
  } finally {
    if (held && (await kvGetJson<string>(lockKey(id))) === token) await kvDelete([lockKey(id)]);
  }
}

export async function readMeet(id: string): Promise<Meetup | null> {
  if (!/^m_[a-z2-9]{10}$/.test(id)) return null;
  return kvGetJson<Meetup>(meetKey(id));
}

export async function readApplications(id: string): Promise<Application[]> {
  return (await kvGetJson<Application[]>(appsKey(id))) ?? [];
}

async function saveMeet(meet: Meetup, now: number): Promise<void> {
  await kvSetJson(meetKey(meet.id), meet, ttlFor(meet.at, now));
}

async function saveApplications(meet: Meetup, apps: Application[], now: number): Promise<void> {
  await kvSetJson(appsKey(meet.id), apps, ttlFor(meet.at, now));
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newMeetId(): string {
  let id = "m_";
  for (let i = 0; i < 10; i += 1) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return id;
}

/** 단체방에 지금 들어온 사람(방장 포함)의 성별 수. 데이팅 프로필이 없으면 세지 않는다. */
export async function filledOf(meet: Meetup): Promise<{ m: number; f: number; members: string[] }> {
  const group = await readGroup(meet.groupId);
  const members = group?.members ?? [];
  const profiles = await readDatingProfiles(members);
  const filled = { m: 0, f: 0 };
  for (const profile of profiles) if (profile) filled[profile.gender] += 1;
  return { ...filled, members };
}

/** 내가 연, 아직 열려 있는 모임 수. */
async function openHosted(host: string, now: number): Promise<number> {
  const rows = await kvZRevRange(hostKey(host), 0, 50);
  let count = 0;
  for (const row of rows) {
    if (row.score + MEET_OPEN_AFTER_MS < now) continue;
    const meet = await readMeet(row.member);
    if (meet && !meet.closed) count += 1;
  }
  return count;
}

export type CreateResult = { ok: Meetup } | { error: "HOST_LIMIT" };

export async function createMeet(host: string, input: MeetInput, now: number = Date.now()): Promise<CreateResult> {
  if ((await openHosted(host, now)) >= MEET_HOST_MAX) return { error: "HOST_LIMIT" };
  let id = newMeetId();
  for (let tries = 0; tries < 3 && (await readMeet(id)); tries += 1) id = newMeetId();
  const group = await createGroup({ owner: host, name: input.area, languages: [], invite: [] });
  const meet: Meetup = { ...input, id, host, groupId: group.id, createdAt: now };
  await saveMeet(meet, now);
  await saveApplications(meet, [], now);
  await kvZAdd(regionKey(meet.region), meet.at, id);
  await kvZAdd(hostKey(host), meet.at, id);
  return { ok: meet };
}

/** 그 지역에서 아직 끝나지 않은 모임, 가까운 시각 순. */
export async function listMeets(region: Region, now: number = Date.now(), limit = 50): Promise<Meetup[]> {
  const rows = await kvZRevRange(regionKey(region), 0, 300);
  const live = rows.filter((row) => row.score + MEET_OPEN_AFTER_MS > now).sort((a, b) => a.score - b.score);
  const out: Meetup[] = [];
  for (const row of live) {
    if (out.length >= limit) break;
    const meet = await readMeet(row.member);
    if (meet && !meet.closed) out.push(meet);
  }
  return out;
}

/** 내가 열었거나 신청한 모임(최근 시각 순). */
export async function myMeetIds(me: string): Promise<string[]> {
  const [hosted, applied] = await Promise.all([kvZRevRange(hostKey(me), 0, 50), kvZRevRange(mineKey(me), 0, 100)]);
  return [...new Set([...hosted, ...applied].sort((a, b) => b.score - a.score).map((row) => row.member))];
}

export type ApplyError = "NO_MEET" | "SELF" | "CLOSED" | "NO_SEAT" | "ALREADY" | "REJECTED" | "LIMIT";

export async function apply(me: string, gender: Gender, id: string, now: number = Date.now()): Promise<{ ok: true } | { error: ApplyError }> {
  return withLock(id, async () => {
    const meet = await readMeet(id);
    if (!meet) return { error: "NO_MEET" };
    if (meet.host === me) return { error: "SELF" };
    const apps = await readApplications(id);
    const mine = apps.find((row) => row.account === me);
    if (mine?.state === "rejected") return { error: "REJECTED" };
    if (mine) return { error: "ALREADY" };
    const filled = await filledOf(meet);
    if (!isOpen(meet, filled, now)) return { error: "CLOSED" };
    if (!seatLeft(meet.seats, filled, gender)) return { error: "NO_SEAT" };
    const day = new Date(now).toISOString().slice(0, 10);
    if ((await kvIncrBy(appliesKey(me, day), 1, 2 * 24 * 60 * 60)) > MEET_APPLY_PER_DAY) return { error: "LIMIT" };
    await saveApplications(meet, [...apps, { account: me, gender, at: now, state: "pending" }], now);
    await kvZAdd(mineKey(me), meet.at, id);
    return { ok: true };
  });
}

/** 신청 취소(아직 승인 전). */
export async function cancelApply(me: string, id: string, now: number = Date.now()): Promise<boolean> {
  return withLock(id, async () => {
    const meet = await readMeet(id);
    if (!meet) return false;
    const apps = await readApplications(id);
    const mine = apps.find((row) => row.account === me);
    if (!mine || mine.state !== "pending") return false;
    await saveApplications(meet, apps.filter((row) => row.account !== me), now);
    await kvZRem(mineKey(me), id);
    return true;
  });
}

export type DecideError = "NO_MEET" | "NOT_HOST" | "NO_APPLICATION" | "NO_SEAT" | "JOIN_FAILED";

/** 방장: 승인하면 단체방에 들어오고, 거절하면 다시 신청할 수 없다. */
export async function decide(host: string, id: string, target: string, approve: boolean, now: number = Date.now()): Promise<{ ok: true } | { error: DecideError }> {
  return withLock(id, async () => {
    const meet = await readMeet(id);
    if (!meet) return { error: "NO_MEET" };
    if (meet.host !== host) return { error: "NOT_HOST" };
    const apps = await readApplications(id);
    const app = apps.find((row) => row.account === target && row.state === "pending");
    if (!app) return { error: "NO_APPLICATION" };
    if (approve) {
      const filled = await filledOf(meet);
      if (!seatLeft(meet.seats, filled, app.gender)) return { error: "NO_SEAT" };
      const invited = await inviteToGroup(host, meet.groupId, target);
      const joined = invited === "ok" ? await answerInvite(target, meet.groupId, true) : null;
      if (!joined) return { error: "JOIN_FAILED" };
    }
    const next = apps.map((row) => (row.account === target ? { ...row, state: approve ? ("approved" as const) : ("rejected" as const) } : row));
    await saveApplications(meet, next, now);
    return { ok: true };
  });
}

/** 방장: 들어온 사람 내보내기(원본 kickFromGroup) — 다시 신청할 수 없게 거절로 남긴다. */
export async function removeMember(host: string, id: string, target: string, now: number = Date.now()): Promise<boolean> {
  return withLock(id, async () => {
    const meet = await readMeet(id);
    if (!meet || meet.host !== host || target === host) return false;
    if ((await kickFromGroup(host, meet.groupId, target)) !== "ok") return false;
    const apps = await readApplications(id);
    await saveApplications(meet, apps.map((row) => (row.account === target ? { ...row, state: "rejected" as const } : row)), now);
    return true;
  });
}

/** 참가자: 모임에서 나가기 — 단체방에서도 나가고 신청 기록을 지운다(다시 신청할 수 있음). */
export async function leaveMeet(me: string, id: string, now: number = Date.now()): Promise<boolean> {
  return withLock(id, async () => {
    const meet = await readMeet(id);
    if (!meet || meet.host === me) return false;
    await leaveGroup(me, meet.groupId);
    const apps = await readApplications(id);
    await saveApplications(meet, apps.filter((row) => row.account !== me), now);
    await kvZRem(mineKey(me), id);
    return true;
  });
}

/** 방장: 모집 닫기(단체방 채팅은 그대로). */
export async function closeMeet(host: string, id: string, now: number = Date.now()): Promise<boolean> {
  const meet = await readMeet(id);
  if (!meet || meet.host !== host) return false;
  await saveMeet({ ...meet, closed: true }, now);
  await kvZRem(regionKey(meet.region), id);
  return true;
}

/** 오늘 남은 신청 수. */
export async function appliesLeft(me: string, now: number = Date.now()): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  return Math.max(0, MEET_APPLY_PER_DAY - (await kvGetNumber(appliesKey(me, day))));
}

/** 계정을 지울 때: 연 모임은 닫고, 신청은 지운다. 단체방은 accountStore가 leaveAllGroups로 나간다. */
export async function forgetMeets(account: string): Promise<void> {
  for (const id of await myMeetIds(account)) {
    const meet = await readMeet(id);
    if (!meet) continue;
    if (meet.host === account) await closeMeet(account, id);
    else {
      const apps = await readApplications(id);
      await saveApplications(meet, apps.filter((row) => row.account !== account), Date.now());
    }
  }
  await kvDelete([hostKey(account), mineKey(account)]);
}
