/**
 * 단체방 저장소 (KV). 규칙은 rooms/group.ts.
 *
 *   grp:v1:g:<방>           방 한 줄(Group) — 사람·초대·마지막 말
 *   grp:v1:m:<방>           줄 목록(RPUSH)
 *   grp:v1:seq:<방>         줄 번호
 *   grp:v1:box:<계정>       내가 낀(초대 포함) 방 id 목록(RPUSH, 읽을 때 정리)
 *   grp:v1:read:<계정>:<방> 내가 읽은 마지막 줄 번호
 *
 * 모두 마지막 활동으로부터 30일이면 사라진다. 팀·러닝메이트(Group.team)는 400일, 그리고
 *   grp:v1:ws:<방>          워크스페이스에 쌓인 것(SpaceItem, RPUSH, 최대 SPACE_MAX_ITEMS)
 *   grp:v1:days:<방>        같이 한 날("YYYY-MM-DD" 목록)
 * 나가거나 내보내지면 그 사람이 남긴 것은 워크스페이스에서 지운다(withoutMember).
 */
import {
  GROUP_MAX_KEPT,
  GROUP_TTL_SECONDS,
  SPACE_MAX_ITEMS,
  TEAM_TTL_SECONDS,
  canInvite,
  dayOf,
  groupTtl,
  newGroupId,
  withoutMember,
  type Group,
  type GroupMessage,
  type GroupSummary,
  type SpaceItem,
  type TeamInfo,
  type TeamSpace,
} from "../rooms/group.ts";
import { cleanFocus, clipQuote, type LineQuote } from "../rooms/quote.ts";
import type { MediaRef } from "../rooms/media.ts";
import { kvDelete, kvGetJson, kvGetJsonMany, kvIncrBy, kvListPush, kvListRange, kvListRemove, kvListTrim, kvSetJson, kvSetJsonIfAbsent } from "./kv.ts";
import { rowsAfter } from "./lateRows.ts";

const groupKey = (id: string) => `grp:v1:g:${id}`;
const msgsKey = (id: string) => `grp:v1:m:${id}`;
const seqKey = (id: string) => `grp:v1:seq:${id}`;
const boxKey = (account: string) => `grp:v1:box:${account}`;
const readKey = (account: string, id: string) => `grp:v1:read:${account}:${id}`;
const spaceKey = (id: string) => `grp:v1:ws:${id}`;
const daysKey = (id: string) => `grp:v1:days:${id}`;
const DAYS_KEEP = 400;
const BOX_KEEP = 100;

const lockKey = (id: string) => `grp:v1:lock:${id}`;
/** 모두에게서 지운 줄 번호들 — 이미 받아 둔 앱이 지우도록 poll에 같이 보낸다. */
const goneKey = (id: string) => `grp:v1:gone:${id}`;

/**
 * 한 단체방의 정보(사람·방장·마지막 줄)를 읽고 고쳐 쓰는 동작을 한 줄로 세운다. 둘이 동시에 초대를 받으면
 * 서로 읽은 옛 정보로 덮어써 한 사람이 빠졌다(가상 사용자 겹침 점검 2026-10-19). 줄 번호와 목록 순서도
 * 같은 순서가 된다. 3초 안에 못 잡으면 막지 않고 그냥 한다(멈춤보다 낫다, 이어 받기는 lateRows가 메움).
 */
async function withGroupLock<T>(id: string, work: () => Promise<T>): Promise<T> {
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

export async function readGroup(id: string): Promise<Group | null> {
  return kvGetJson<Group>(groupKey(id));
}

async function saveGroup(group: Group): Promise<void> {
  await kvSetJson(groupKey(group.id), group, groupTtl(group));
}

/** 줄 없이 방 정보만 고칠 때(통화 번호 지우기 등). */
export const saveGroupMeta = saveGroup;

async function addToBox(account: string, id: string, ttl: number = GROUP_TTL_SECONDS): Promise<void> {
  // 같은 목록에 팀과 단체방이 섞이므로, 팀이 하나라도 들어가면 목록은 팀만큼 오래 둔다.
  await kvListPush(boxKey(account), [id], ttl);
  await kvListTrim(boxKey(account), BOX_KEEP);
}

function parse(rows: string[]): GroupMessage[] {
  const out: GroupMessage[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row) as GroupMessage);
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }
  return out;
}

export async function readGroupMessages(id: string, since = 0): Promise<GroupMessage[]> {
  return rowsAfter(parse(await kvListRange(msgsKey(id), -GROUP_MAX_KEPT, -1)), since);
}

async function push(group: Group, message: Omit<GroupMessage, "seq" | "at">): Promise<{ group: Group; message: GroupMessage }> {
  const ttl = groupTtl(group);
  const seq = await kvIncrBy(seqKey(group.id), 1, ttl);
  const now = Date.now();
  const row: GroupMessage = { ...message, seq, at: now };
  await kvListPush(msgsKey(group.id), [JSON.stringify(row)], ttl);
  if (group.team && (row.kind === "text" || row.kind === "callLog")) await noteDay(group.id, now);
  await kvListTrim(msgsKey(group.id), GROUP_MAX_KEPT);
  const next: Group = {
    ...group,
    lastAt: now,
    lastSeq: seq,
    ...(row.kind === "text" ? { lastText: row.image ? (row.text ? `📷 ${row.text}` : "📷") : row.text, lastFrom: row.from } : {}),
  };
  await saveGroup(next);
  return { group: next, message: row };
}

export async function createGroup(input: { owner: string; name: string; languages: string[]; invite: string[] }): Promise<Group> {
  const now = Date.now();
  let id = newGroupId();
  for (let tries = 0; tries < 3 && (await readGroup(id)); tries += 1) id = newGroupId();
  let group: Group = {
    id,
    name: input.name,
    languages: input.languages.slice(0, 2),
    owner: input.owner,
    members: [input.owner],
    invited: [],
    createdAt: now,
    lastAt: now,
    lastText: "",
    lastFrom: input.owner,
    lastSeq: 0,
  };
  for (const target of input.invite) {
    if (target !== input.owner && canInvite(group, target) === "ok") group = { ...group, invited: [...group.invited, target] };
  }
  await saveGroup(group);
  await Promise.all([input.owner, ...group.invited].map((account) => addToBox(account, id)));
  return group;
}

/** 초대: 방에 있는 사람이면 누구나(정원 안에서). */
async function inviteToGroupUnlocked(by: string, id: string, target: string): Promise<"ok" | "NO_GROUP" | "NOT_MEMBER" | "ALREADY" | "FULL"> {
  const group = await readGroup(id);
  if (!group) return "NO_GROUP";
  if (!group.members.includes(by)) return "NOT_MEMBER";
  const can = canInvite(group, target);
  if (can !== "ok") return can;
  await saveGroup({ ...group, invited: [...group.invited, target], kicked: (group.kicked ?? []).filter((row) => row !== target) });
  await addToBox(target, id);
  return "ok";
}

/** 초대에 답하기. 참여하면 "들어왔어요" 알림 줄. */
async function answerInviteUnlocked(account: string, id: string, accept: boolean): Promise<Group | null> {
  const group = await readGroup(id);
  if (!group || !group.invited.includes(account)) return null;
  const invited = group.invited.filter((row) => row !== account);
  if (!accept) {
    const next = { ...group, invited };
    await saveGroup(next);
    return next;
  }
  const joined = { ...group, invited, members: [...group.members, account] };
  if (group.team) await addToBox(account, id, TEAM_TTL_SECONDS);
  return (await push(joined, { from: account, kind: "system", text: "join" })).group;
}

/** 나가기. 방장이 나가면 가장 먼저 들어온 사람이 방장, 아무도 없으면 방은 그대로 사라지게 둔다. */
async function leaveGroupUnlocked(account: string, id: string): Promise<boolean> {
  const group = await readGroup(id);
  if (!group || !group.members.includes(account)) return false;
  const members = group.members.filter((row) => row !== account);
  const owner = group.owner === account ? (members[0] ?? group.owner) : group.owner;
  const next = { ...group, members, owner };
  if (group.team) await forgetInSpace(group, account);
  if (members.length === 0) {
    await saveGroup(next);
    return true;
  }
  const after = await push(next, { from: account, kind: "system", text: "leave" });
  if (owner !== group.owner) await push(after.group, { from: owner, kind: "system", text: "host" });
  return true;
}

/** 방장만: 내보내기(초대 중인 사람이면 초대 취소). */
async function kickFromGroupUnlocked(by: string, id: string, target: string): Promise<"ok" | "NO_GROUP" | "NOT_OWNER" | "NO_TARGET"> {
  const group = await readGroup(id);
  if (!group) return "NO_GROUP";
  if (group.owner !== by) return "NOT_OWNER";
  if (target === by) return "NO_TARGET";
  if (group.invited.includes(target)) {
    await saveGroup({ ...group, invited: group.invited.filter((row) => row !== target) });
    return "ok";
  }
  if (!group.members.includes(target)) return "NO_TARGET";
  if (group.team) await forgetInSpace(group, target);
  await push(
    { ...group, members: group.members.filter((row) => row !== target), kicked: [...(group.kicked ?? []).filter((row) => row !== target), target].slice(-200) },
    { from: target, kind: "system", text: "kick" },
  );
  return "ok";
}

/** 방장만: 방장 넘기기(방에 있는 사람에게). */
async function transferGroupUnlocked(by: string, id: string, target: string): Promise<"ok" | "NO_GROUP" | "NOT_OWNER" | "NO_TARGET"> {
  const group = await readGroup(id);
  if (!group) return "NO_GROUP";
  if (group.owner !== by) return "NOT_OWNER";
  if (target === by || !group.members.includes(target)) return "NO_TARGET";
  await push({ ...group, owner: target }, { from: target, kind: "system", text: "host" });
  return "ok";
}

/** 글 보내기: 방에 있는 사람만. quoteSeq를 주면 이 방의 글 한 줄을 인용(묻기·답하기). */
async function sendToGroupUnlocked(input: {
  from: string;
  id: string;
  text: string;
  quoteSeq?: number;
  ask?: boolean;
  /** 인용한 줄 안에서 고른 부분(인용 글 안에 있을 때만 남음). */
  quoteFocus?: unknown;
  /** 붙인 사진(부르는 쪽이 claimMedia로 확인한 것). */
  image?: MediaRef;
  /** 보낸 아이콘(부르는 쪽이 takeIcon으로 확인한 것). */
  icon?: GroupMessage["icon"];
}): Promise<{ ok: true; group: Group; message: GroupMessage } | { ok: false; error: "NO_GROUP" | "NOT_MEMBER" | "NO_QUOTE" }> {
  const group = await readGroup(input.id);
  if (!group) return { ok: false, error: "NO_GROUP" };
  if (!group.members.includes(input.from)) return { ok: false, error: "NOT_MEMBER" };
  let quote: LineQuote | undefined;
  if (typeof input.quoteSeq === "number") {
    const found = (await readGroupMessages(group.id)).find((row) => row.seq === input.quoteSeq && row.kind === "text");
    if (!found) return { ok: false, error: "NO_QUOTE" };
    const text = clipQuote(found.text);
    const focus = cleanFocus(text, input.quoteFocus);
    quote = { seq: found.seq, nickname: "", text, accountId: found.from, ...(focus ? { focus } : {}) };
  }
  const result = await push(group, {
    from: input.from,
    kind: "text",
    text: input.text,
    ...(quote ? { quote, ask: input.ask === true } : {}),
    ...(input.image ? { image: input.image } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
  });
  // 팀에서 "무슨 뜻이에요?"로 물은 줄은 워크스페이스 표현으로 남는다.
  if (group.team && quote && input.ask === true) {
    await addSpaceItem(group, { kind: "phrase", by: input.from, text: quote.focus ?? quote.text, from: quote.accountId ?? null });
  }
  return { ok: true, ...result };
}

/** 이 단체방에서 다른 사람들이 읽은 마지막 줄 번호들(누구인지는 빼고) — 읽음 표시를 끈 사람(off)은 뺀다. */
export async function othersRead(group: Pick<Group, "id" | "members">, me: string, off: (account: string) => boolean): Promise<number[]> {
  const others = group.members.filter((account) => account !== me && !off(account));
  if (!others.length) return [];
  const rows = await kvGetJsonMany<number>(others.map((account) => readKey(account, group.id)));
  return rows.map((row) => (typeof row === "number" ? row : 0));
}

export async function markGroupRead(account: string, id: string, seq: number): Promise<void> {
  const group = await readGroup(id);
  await kvSetJson(readKey(account, id), seq, group ? groupTtl(group) : GROUP_TTL_SECONDS);
}

/** 내 단체방과 받은 초대(초대가 위, 그다음 최근 순). */
export async function myGroups(account: string): Promise<GroupSummary[]> {
  const ids = [...new Set(await kvListRange(boxKey(account)))];
  const rows = await Promise.all(
    ids.map(async (id): Promise<GroupSummary | null> => {
      const group = await readGroup(id);
      if (!group) return null;
      if (group.invited.includes(account)) return { group, unread: 0, invite: true };
      if (!group.members.includes(account)) return null;
      const read = (await kvGetJson<number>(readKey(account, id))) ?? 0;
      return { group, unread: Math.max(0, group.lastSeq - read), invite: false };
    }),
  );
  return rows
    .filter((row): row is GroupSummary => row !== null)
    .sort((a, b) => Number(b.invite) - Number(a.invite) || b.group.lastAt - a.group.lastAt);
}

export async function readGroupGone(id: string): Promise<number[]> {
  return (await kvGetJson<number[]>(goneKey(id))) ?? [];
}

export type GroupUnsendResult = { ok: true; message: GroupMessage } | { ok: false; error: "NOT_FOUND" | "NOT_YOURS" };

/**
 * 보낸 줄 지우기(2026-10-23): 내 글·사진은 내가, 통화 기록은 남긴 사람이나 방장이. 알림 줄(system)은 못 지움.
 * 줄은 목록에서 바로 빼고(LREM), 번호는 gone에 남겨 이미 받아 둔 다른 사람 앱도 지운다. 사진 파일은 부르는 쪽이 지운다.
 */
export async function unsendGroupMessage(me: string, id: string, seq: number): Promise<GroupUnsendResult> {
  return withGroupLock(id, async () => {
    const group = await readGroup(id);
    if (!group || !group.members.includes(me)) return { ok: false, error: "NOT_FOUND" } as const;
    const raws = await kvListRange(msgsKey(id), -GROUP_MAX_KEPT, -1);
    let raw: string | undefined;
    let message: GroupMessage | undefined;
    for (const row of raws) {
      try {
        const parsed = JSON.parse(row) as GroupMessage;
        if (parsed.seq === seq) {
          raw = row;
          message = parsed;
          break;
        }
      } catch {
        // 깨진 줄은 건너뛴다.
      }
    }
    if (!raw || !message || message.kind === "system") return { ok: false, error: "NOT_FOUND" } as const;
    const allowed = message.from === me || (message.kind === "callLog" && group.owner === me);
    if (!allowed) return { ok: false, error: "NOT_YOURS" } as const;
    const ttl = groupTtl(group);
    await kvListRemove(msgsKey(id), raw);
    const gone = [...new Set([...(await readGroupGone(id)), seq])].slice(-200);
    await kvSetJson(goneKey(id), gone, ttl);
    const last = parse(await kvListRange(msgsKey(id), -GROUP_MAX_KEPT, -1))
      .filter((row) => row.kind === "text")
      .at(-1);
    const preview = last ? (last.image ? (last.text ? `📷 ${last.text}` : "📷") : last.text) : "";
    if (group.lastText !== preview) await saveGroup({ ...group, lastText: preview, ...(last ? { lastFrom: last.from } : {}) });
    return { ok: true, message } as const;
  });
}

/** 통화를 연 사람이 남기는 "통화 시작" 알림 줄과 방 번호. */
export async function noteGroupCall(group: Group, from: string, roomId: string): Promise<Group> {
  return withGroupLock(group.id, async () => {
    const fresh = (await readGroup(group.id)) ?? group;
    return (await push({ ...fresh, callRoomId: roomId }, { from, kind: "system", text: "call", roomId })).group;
  });
}

/** 통화가 끝난 뒤 자막 기록을 한 번 남긴다(누가 남길지는 호출하는 쪽이 SET NX로 정한다). */
export async function logGroupCall(group: Group, from: string, roomId: string, lines: NonNullable<GroupMessage["lines"]>): Promise<void> {
  await withGroupLock(group.id, async () => {
    // 사람·방장은 지금 것으로, 통화 번호는 부른 쪽이 정한 대로(끝난 통화면 지운 채로).
    const fresh = await readGroup(group.id);
    return push(fresh ? { ...fresh, callRoomId: group.callRoomId } : group, { from, kind: "callLog", text: `${lines.length}`, roomId, lines });
  });
  if (group.team) await addSpaceItem(group, { kind: "session", by: from, text: `${lines.length}`, lines });
}

// ── 팀·러닝메이트 ───────────────────────────────────────────

async function noteDay(id: string, at: number): Promise<void> {
  const day = dayOf(at);
  const days = (await kvGetJson<string[]>(daysKey(id))) ?? [];
  if (days.at(-1) === day) return;
  await kvSetJson(daysKey(id), [...days.filter((row) => row !== day), day].slice(-DAYS_KEEP), TEAM_TTL_SECONDS);
}

function parseItems(rows: string[]): SpaceItem[] {
  const out: SpaceItem[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row) as SpaceItem);
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }
  return out;
}

async function readItems(id: string): Promise<SpaceItem[]> {
  return parseItems(await kvListRange(spaceKey(id), -SPACE_MAX_ITEMS, -1));
}

async function writeItems(id: string, items: SpaceItem[]): Promise<void> {
  await kvDelete([spaceKey(id)]);
  if (items.length) await kvListPush(spaceKey(id), items.slice(-SPACE_MAX_ITEMS).map((item) => JSON.stringify(item)), TEAM_TTL_SECONDS);
}

export async function addSpaceItem(group: Group, item: Omit<SpaceItem, "id" | "at">): Promise<SpaceItem> {
  const row: SpaceItem = { ...item, id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, at: Date.now() };
  await kvListPush(spaceKey(group.id), [JSON.stringify(row)], TEAM_TTL_SECONDS);
  await kvListTrim(spaceKey(group.id), SPACE_MAX_ITEMS);
  await noteDay(group.id, row.at);
  return row;
}

/** 내가 공유한 것만 지울 수 있다. */
export async function removeSpaceItem(group: Group, by: string, itemId: string): Promise<boolean> {
  const items = await readItems(group.id);
  const target = items.find((item) => item.id === itemId);
  if (!target || target.by !== by || target.kind === "session") return false;
  await writeItems(group.id, items.filter((item) => item.id !== itemId));
  return true;
}

async function forgetInSpace(group: Group, account: string): Promise<void> {
  const items = await readItems(group.id);
  const kept = withoutMember(items, account);
  if (kept.length !== items.length || kept.some((item, index) => item !== items[index])) await writeItems(group.id, kept);
}

export async function readSpace(id: string): Promise<TeamSpace> {
  const [items, days] = await Promise.all([readItems(id), kvGetJson<string[]>(daysKey(id))]);
  return { items: items.reverse(), days: days ?? [] };
}

/** 단체방을 팀으로(방장만). 이후 키는 400일, 모두의 목록도 그만큼. */
async function makeTeamUnlocked(by: string, id: string): Promise<Group | "NO_GROUP" | "NOT_OWNER" | "ALREADY"> {
  const group = await readGroup(id);
  if (!group) return "NO_GROUP";
  if (group.owner !== by) return "NOT_OWNER";
  if (group.team) return "ALREADY";
  const next: Group = { ...group, team: { kind: "team", since: Date.now() } };
  await Promise.all([...next.members, ...next.invited].map((account) => addToBox(account, id, TEAM_TTL_SECONDS)));
  return (await push(next, { from: by, kind: "system", text: "team" })).group;
}

/** 팀 정보 고치기(목표·정기 모임) — 팀에 있는 사람이면 누구나. */
async function updateTeamUnlocked(by: string, id: string, patch: Partial<Pick<TeamInfo, "goal" | "schedule">>): Promise<Group | null> {
  const group = await readGroup(id);
  if (!group?.team || !group.members.includes(by)) return null;
  const team: TeamInfo = {
    ...group.team,
    ...(patch.goal !== undefined ? { goal: patch.goal, goalBy: by } : {}),
    ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
  };
  const next = { ...group, team };
  await saveGroup(next);
  return next;
}

/**
 * 러닝메이트 신청: 두 사람 사이 메이트는 하나.
 *  - 상대가 이미 나에게 신청했으면 그걸 수락(→ "joined")
 *  - 내가 이미 신청했거나 이미 메이트면 그대로(→ "pending" | "mates")
 *  - 아니면 새로 만들고 상대를 초대(→ "pending")
 */
export async function requestMate(me: string, target: string, languages: string[]): Promise<{ group: Group; state: "pending" | "joined" | "mates" }> {
  const ids = [...new Set(await kvListRange(boxKey(me)))];
  for (const id of ids) {
    const group = await readGroup(id);
    if (group?.team?.kind !== "mate") continue;
    const people = [...group.members, ...group.invited];
    if (!people.includes(me) || !people.includes(target)) continue;
    if (group.members.includes(me) && group.members.includes(target)) return { group, state: "mates" };
    if (group.invited.includes(me)) {
      const joined = await answerInvite(me, id, true);
      if (joined) return { group: joined, state: "joined" };
    }
    if (group.members.includes(me) && group.invited.includes(target)) return { group, state: "pending" };
    if (group.members.includes(me) && !group.members.includes(target)) {
      await inviteToGroup(me, id, target);
      return { group: (await readGroup(id)) ?? group, state: "pending" };
    }
  }
  const now = Date.now();
  let id = newGroupId();
  for (let tries = 0; tries < 3 && (await readGroup(id)); tries += 1) id = newGroupId();
  const group: Group = {
    id,
    name: "",
    languages: languages.slice(0, 2),
    owner: me,
    members: [me],
    invited: [target],
    createdAt: now,
    lastAt: now,
    lastText: "",
    lastFrom: me,
    lastSeq: 0,
    team: { kind: "mate", since: now },
  };
  await saveGroup(group);
  await Promise.all([me, target].map((account) => addToBox(account, id, TEAM_TTL_SECONDS)));
  return { group, state: "pending" };
}

/** 계정을 지울 때: 모든 단체방·팀에서 나가고(팀이면 내 것을 지움), 받은 초대는 거절. */
export async function leaveAllGroups(account: string): Promise<void> {
  for (const summary of await myGroups(account)) {
    if (summary.invite) await answerInvite(account, summary.group.id, false);
    else await leaveGroup(account, summary.group.id);
  }
}

export const inviteToGroup = (by: string, id: string, target: string) => withGroupLock(id, () => inviteToGroupUnlocked(by, id, target));

export const answerInvite = (account: string, id: string, accept: boolean) => withGroupLock(id, () => answerInviteUnlocked(account, id, accept));

export const leaveGroup = (account: string, id: string) => withGroupLock(id, () => leaveGroupUnlocked(account, id));

export const kickFromGroup = (by: string, id: string, target: string) => withGroupLock(id, () => kickFromGroupUnlocked(by, id, target));

export const transferGroup = (by: string, id: string, target: string) => withGroupLock(id, () => transferGroupUnlocked(by, id, target));

export const makeTeam = (by: string, id: string) => withGroupLock(id, () => makeTeamUnlocked(by, id));

export const updateTeam = (by: string, id: string, patch: Partial<Pick<TeamInfo, "goal" | "schedule">>) => withGroupLock(id, () => updateTeamUnlocked(by, id, patch));

export const sendToGroup = (input: Parameters<typeof sendToGroupUnlocked>[0]) => withGroupLock(input.id, () => sendToGroupUnlocked(input));
