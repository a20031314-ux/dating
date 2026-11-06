import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_MAX_MEMBERS } from "../rooms/group.ts";
import {
  answerInvite,
  createGroup,
  inviteToGroup,
  kickFromGroup,
  leaveGroup,
  logGroupCall,
  noteGroupCall,
  markGroupRead,
  myGroups,
  othersRead,
  readGroup,
  readGroupGone,
  readGroupMessages,
  sendToGroup,
  unsendGroupMessage,
  transferGroup,
} from "./groupStore.ts";

// KV 접속 정보 없이 메모리로(kv.ts).
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const id = (c: string) => "lb_" + c.repeat(24);
const MINJI = id("1");
const YUKI = id("2");
const LUCIA = id("3");
const OMAR = id("4");

test("초대로만: 초대받은 사람은 참여 전엔 못 쓰고, 참여하면 알림 줄과 함께 들어온다", async () => {
  const group = await createGroup({ owner: MINJI, name: "日本語 ↔ 한국어 스터디", languages: ["ja", "ko"], invite: [YUKI, LUCIA, MINJI] });
  assert.deepEqual(group.members, [MINJI]);
  assert.deepEqual(group.invited, [YUKI, LUCIA]);
  const yukiBox = await myGroups(YUKI);
  assert.equal(yukiBox[0].invite, true);
  assert.deepEqual(await sendToGroup({ from: YUKI, id: group.id, text: "こんにちは" }), { ok: false, error: "NOT_MEMBER" });
  await answerInvite(YUKI, group.id, true);
  await answerInvite(LUCIA, group.id, false);
  const after = await readGroup(group.id);
  assert.deepEqual(after?.members, [MINJI, YUKI]);
  assert.deepEqual(after?.invited, []);
  assert.equal((await myGroups(LUCIA)).length, 0);
  const sent = await sendToGroup({ from: YUKI, id: group.id, text: "よろしくお願いします！" });
  assert.ok(sent.ok);
  const rows = await readGroupMessages(group.id);
  assert.deepEqual(rows.map((row) => [row.kind, row.text]), [["system", "join"], ["text", "よろしくお願いします！"]]);
  // 안 읽은 수: 민지는 2줄, 읽고 나면 0.
  assert.equal((await myGroups(MINJI))[0].unread, 2);
  await markGroupRead(MINJI, group.id, sent.ok ? sent.message.seq : 0);
  assert.equal((await myGroups(MINJI))[0].unread, 0);
});

test("묻기: 이 방의 글 한 줄만 인용, 질문 표시", async () => {
  const group = await createGroup({ owner: MINJI, name: "Español ↔ 한국어", languages: ["es", "ko"], invite: [OMAR] });
  await answerInvite(OMAR, group.id, true);
  const line = await sendToGroup({ from: MINJI, id: group.id, text: "¡Qué guay!" });
  assert.ok(line.ok);
  const ask = await sendToGroup({ from: OMAR, id: group.id, text: "¿Qué significa esto?", quoteSeq: line.ok ? line.message.seq : 0, ask: true });
  assert.ok(ask.ok && ask.message.ask === true && ask.message.quote?.text === "¡Qué guay!" && ask.message.quote.accountId === MINJI);
  assert.deepEqual(await sendToGroup({ from: OMAR, id: group.id, text: "?", quoteSeq: 1 }), { ok: false, error: "NO_QUOTE" });
  // 줄 안에서 고른 부분: 그 줄에 있는 말만 남고, 없는 말은 버려 줄 전체 질문이 된다.
  const ja = await sendToGroup({ from: MINJI, id: group.id, text: "週末は友だちと映画を見に行きます。" });
  const seq = ja.ok ? ja.message.seq : 0;
  const picked = await sendToGroup({ from: OMAR, id: group.id, text: "「映画」ってどういう意味ですか？", quoteSeq: seq, ask: true, quoteFocus: "映画" });
  assert.ok(picked.ok && picked.message.quote?.focus === "映画");
  const made = await sendToGroup({ from: OMAR, id: group.id, text: "?", quoteSeq: seq, ask: true, quoteFocus: "寿司" });
  assert.ok(made.ok && made.message.quote && made.message.quote.focus === undefined);
});

test("정원·방장: 20명까지, 방장만 내보내기·넘기기, 방장이 나가면 다음 사람", async () => {
  const many = Array.from({ length: GROUP_MAX_MEMBERS + 3 }, (_, i) => "lb_" + i.toString(16).padStart(24, "a"));
  const group = await createGroup({ owner: MINJI, name: "ภาษาไทย ↔ English", languages: ["th", "en"], invite: many });
  assert.equal(group.members.length + group.invited.length, GROUP_MAX_MEMBERS);
  assert.equal(await inviteToGroup(MINJI, group.id, YUKI), "FULL");

  const small = await createGroup({ owner: MINJI, name: "small", languages: [], invite: [YUKI, OMAR] });
  await answerInvite(YUKI, small.id, true);
  await answerInvite(OMAR, small.id, true);
  assert.equal(await kickFromGroup(YUKI, small.id, OMAR), "NOT_OWNER");
  assert.equal(await transferGroup(MINJI, small.id, YUKI), "ok");
  assert.equal((await readGroup(small.id))?.owner, YUKI);
  assert.equal(await kickFromGroup(YUKI, small.id, OMAR), "ok");
  assert.deepEqual((await readGroup(small.id))?.members, [MINJI, YUKI]);
  await leaveGroup(YUKI, small.id);
  const left = await readGroup(small.id);
  assert.equal(left?.owner, MINJI);
  assert.deepEqual(left?.members, [MINJI]);
  assert.equal(await inviteToGroup(OMAR, small.id, LUCIA), "NOT_MEMBER");
});

test("내보낸 사람은 kicked에 남고, 다시 초대하면 빠진다. 통화 시작·기록 줄", async () => {
  const group = await createGroup({ owner: MINJI, name: "Русский ↔ 日本語", languages: ["ru", "ja"], invite: [OMAR] });
  await answerInvite(OMAR, group.id, true);
  await kickFromGroup(MINJI, group.id, OMAR);
  assert.deepEqual((await readGroup(group.id))?.kicked, [OMAR]);
  await inviteToGroup(MINJI, group.id, OMAR);
  assert.deepEqual((await readGroup(group.id))?.kicked, []);

  const withCall = await noteGroupCall((await readGroup(group.id))!, MINJI, "abcdef");
  assert.equal(withCall.callRoomId, "abcdef");
  await logGroupCall({ ...withCall, callRoomId: undefined }, MINJI, "abcdef", [{ from: MINJI, nickname: "민지", text: "Привет!" }]);
  const rows = await readGroupMessages(group.id);
  const tail = rows.slice(-2).map((row) => [row.kind, row.text, row.roomId]);
  assert.deepEqual(tail, [["system", "call", "abcdef"], ["callLog", "1", "abcdef"]]);
  assert.equal((await readGroup(group.id))?.callRoomId, undefined);
});

test("보낸 줄 지우기: 내 글만, 모두에게서 빠지고 gone에 남는다. 통화 기록은 방장도", async () => {
  const group = await createGroup({ owner: MINJI, name: "unsend", languages: ["es", "th"], invite: [YUKI] });
  await answerInvite(YUKI, group.id, true);
  const mine = await sendToGroup({ from: YUKI, id: group.id, text: "¿Quedamos mañana?" });
  const theirs = await sendToGroup({ from: MINJI, id: group.id, text: "พรุ่งนี้ได้เลย" });
  assert.ok(mine.ok && theirs.ok);
  if (!mine.ok || !theirs.ok) return;
  assert.deepEqual(await unsendGroupMessage(YUKI, group.id, theirs.message.seq), { ok: false, error: "NOT_YOURS" });
  const done = await unsendGroupMessage(YUKI, group.id, mine.message.seq);
  assert.equal(done.ok, true);
  assert.deepEqual((await readGroupMessages(group.id)).filter((row) => row.kind === "text").map((row) => row.text), ["พรุ่งนี้ได้เลย"]);
  assert.deepEqual(await readGroupGone(group.id), [mine.message.seq]);
  assert.equal((await readGroup(group.id))?.lastText, "พรุ่งนี้ได้เลย");
  await logGroupCall((await readGroup(group.id))!, YUKI, "room01", [{ from: YUKI, nickname: "ゆき", text: "もしもし" }]);
  const log = (await readGroupMessages(group.id)).find((row) => row.kind === "callLog")!;
  assert.equal((await unsendGroupMessage(MINJI, group.id, log.seq)).ok, true); // 방장
});

test("읽음: 다른 사람이 읽은 줄 번호만(나·끈 사람 빼고)", async () => {
  const group = await createGroup({ owner: MINJI, name: "읽음", languages: ["ja", "ko"], invite: [YUKI, OMAR] });
  await answerInvite(YUKI, group.id, true);
  await answerInvite(OMAR, group.id, true);
  const now = (await readGroup(group.id))!;
  await markGroupRead(YUKI, group.id, 3);
  assert.deepEqual((await othersRead(now, MINJI, () => false)).sort(), [0, 3]);
  assert.deepEqual(await othersRead(now, MINJI, (account) => account === OMAR), [3]);
  assert.deepEqual(await othersRead(now, MINJI, () => true), []);
});
