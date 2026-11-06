import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatingProfile, Gender } from "../dating/rules.ts";
import type { MeetInput } from "../meet/rules.ts";
import { saveDatingProfile } from "./datingStore.ts";
import { readGroup, readGroupMessages, sendToGroup } from "./groupStore.ts";
import {
  apply,
  cancelApply,
  closeMeet,
  createMeet,
  decide,
  filledOf,
  leaveMeet,
  listMeets,
  myMeetIds,
  readApplications,
  readMeet,
  removeMember,
} from "./meetStore.ts";

// KV 접속 정보 없이 메모리로(kv.ts).
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const id = (c: string) => "lb_" + c.repeat(24);
const HOST = id("a");
const M2 = id("b");
const M3 = id("c");
const F1 = id("d");
const F2 = id("e");
const F3 = id("f");
const HOUR = 60 * 60 * 1000;

async function person(account: string, gender: Gender) {
  const profile: DatingProfile = {
    gender,
    birthYear: 1996,
    region: "seoul",
    want: { genders: ["m", "f"], ageMin: 19, ageMax: 80, regions: [] },
    photos: [],
    visible: true,
    updatedAt: 0,
  };
  await saveDatingProfile(account, profile);
}

const input = (over: Partial<MeetInput> = {}): MeetInput => ({
  region: "seoul",
  area: "홍대입구",
  place: "와우산로 OO포차",
  at: Date.now() + 3 * HOUR,
  seats: { kind: "ratio", m: 2, f: 2 },
  cost: "split",
  note: "",
  ...over,
});

let meetId = "";

test("모임 만들기: 단체방이 같이 생기고 지역 목록에 나온다", async () => {
  for (const [account, gender] of [[HOST, "m"], [M2, "m"], [M3, "m"], [F1, "f"], [F2, "f"], [F3, "f"]] as const) await person(account, gender);
  const created = await createMeet(HOST, input());
  assert.ok("ok" in created);
  meetId = created.ok.id;
  const group = await readGroup(created.ok.groupId);
  assert.deepEqual(group?.members, [HOST]);
  assert.deepEqual((await listMeets("seoul")).map((m) => m.id), [meetId]);
  assert.deepEqual(await listMeets("busan"), []);
});

test("신청 → 승인하면 단체방에 들어오고, 성비 자리가 차면 그 성별은 못 들어온다", async () => {
  assert.deepEqual(await apply(HOST, "m", meetId), { error: "SELF" });
  assert.deepEqual(await apply(M2, "m", meetId), { ok: true });
  assert.deepEqual(await apply(M2, "m", meetId), { error: "ALREADY" });
  assert.deepEqual(await apply(F1, "f", meetId), { ok: true });
  assert.deepEqual(await apply(M3, "m", meetId), { ok: true });

  // 승인 전에는 단체방에 못 쓴다(원본 groupStore 규칙).
  const meet = (await readMeet(meetId))!;
  assert.deepEqual(await sendToGroup({ from: M2, id: meet.groupId, text: "안녕하세요" }), { ok: false, error: "NOT_MEMBER" });

  assert.deepEqual(await decide(M2, meetId, F1, true), { error: "NOT_HOST" });
  assert.deepEqual(await decide(HOST, meetId, M2, true), { ok: true });
  assert.deepEqual(await decide(HOST, meetId, F1, true), { ok: true });
  // 남자 자리 둘(방장 + M2)이 찼다.
  assert.deepEqual(await decide(HOST, meetId, M3, true), { error: "NO_SEAT" });
  assert.deepEqual(await apply(id("g"), "m", meetId), { error: "NO_SEAT" });

  const filled = await filledOf(meet);
  assert.deepEqual([filled.m, filled.f], [2, 1]);
  const sent = await sendToGroup({ from: F1, id: meet.groupId, text: "11시에 봬요!" });
  assert.ok(sent.ok);
  const lines = await readGroupMessages(meet.groupId);
  assert.deepEqual(lines.filter((row) => row.kind === "system").map((row) => row.text), ["join", "join"]);
});

test("거절하면 다시 신청 못 하고, 신청 취소·나가기·내보내기", async () => {
  assert.deepEqual(await decide(HOST, meetId, M3, false), { ok: true });
  assert.deepEqual(await apply(M3, "m", meetId), { error: "REJECTED" });

  assert.deepEqual(await apply(F2, "f", meetId), { ok: true });
  assert.equal(await cancelApply(F2, meetId), true);
  assert.equal((await readApplications(meetId)).some((row) => row.account === F2), false);

  // 나가면 자리가 비고 다시 신청할 수 있다.
  assert.equal(await leaveMeet(F1, meetId), true);
  assert.deepEqual(await apply(F1, "f", meetId), { ok: true });
  assert.deepEqual(await decide(HOST, meetId, F1, true), { ok: true });

  // 내보내면 거절로 남는다.
  assert.equal(await removeMember(HOST, meetId, F1), true);
  const meet = (await readMeet(meetId))!;
  assert.equal((await readGroup(meet.groupId))?.members.includes(F1), false);
  assert.deepEqual(await apply(F1, "f", meetId), { error: "REJECTED" });
  assert.ok((await myMeetIds(HOST)).includes(meetId));
});

test("모집 닫기: 목록에서 빠지고 신청을 안 받는다, 방장은 동시에 셋까지", async () => {
  assert.equal(await closeMeet(M2, meetId), false, "방장만");
  assert.equal(await closeMeet(HOST, meetId), true);
  assert.deepEqual(await listMeets("seoul"), []);
  assert.deepEqual(await apply(F3, "f", meetId), { error: "CLOSED" });

  for (let i = 0; i < 3; i += 1) assert.ok("ok" in (await createMeet(F3, input({ seats: { kind: "any", total: 4 } }))));
  assert.deepEqual(await createMeet(F3, input({ seats: { kind: "any", total: 4 } })), { error: "HOST_LIMIT" });
});
