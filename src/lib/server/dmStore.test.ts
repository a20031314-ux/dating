import { test } from "node:test";
import assert from "node:assert/strict";
import { DM_PENDING_LIMIT, threadIdFor } from "../rooms/dm.ts";
import { claimCallLog, decline, findQuote, hiddenUpTo, hideThread, inbox, markRead, readGone, readMessages, readThread, send, unsend, withoutGone } from "./dmStore.ts";

// KV 접속 정보 없이 메모리로(kv.ts).
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const A = "lb_" + "a".repeat(24);
const B = "lb_" + "b".repeat(24);
const C = "lb_" + "c".repeat(24);

test("첫 메시지는 요청: 보낸 사람은 몇 줄만, 받는 사람이 답하면 열린다", async () => {
  for (let i = 0; i < DM_PENDING_LIMIT; i += 1) {
    const sent = await send({ from: A, to: B, kind: "text", text: `こんにちは ${i}` });
    assert.ok(sent.ok && sent.thread.status === "pending");
  }
  const over = await send({ from: A, to: B, kind: "text", text: "もう一回" });
  assert.deepEqual(over, { ok: false, error: "PENDING_LIMIT" });
  // 통화는 열린 대화에서만.
  assert.equal((await send({ from: A, to: B, kind: "call", text: "", roomId: "abcdef" })).ok, false);

  const boxB = await inbox(B);
  assert.equal(boxB[0].request, true);
  assert.equal(boxB[0].other, A);
  assert.ok(boxB[0].unread > 0);
  assert.equal((await inbox(A))[0].request, false);

  const reply = await send({ from: B, to: A, kind: "text", text: "안녕하세요!" });
  assert.ok(reply.ok && reply.thread.status === "open");
  assert.equal((await send({ from: A, to: B, kind: "text", text: "ありがとう" })).ok, true);
  const call = await send({ from: A, to: B, kind: "call", text: "", roomId: "abcdef" });
  assert.ok(call.ok && call.message.roomId === "abcdef");

  const id = threadIdFor(A, B);
  const all = await readMessages(id);
  await markRead(B, id, all[all.length - 1].seq);
  assert.equal((await inbox(B))[0].unread, 0);
  assert.deepEqual((await readMessages(id, all[all.length - 2].seq)).map((m) => m.kind), ["call"]);
});

test("받은 요청을 거절하면 보낸 사람은 못 보내고, 받은 쪽 목록에서 빠진다", async () => {
  assert.ok((await send({ from: C, to: A, kind: "text", text: "Hola" })).ok);
  assert.equal(await decline(C, threadIdFor(A, C)), false); // 보낸 사람은 거절 못 함
  assert.equal(await decline(A, threadIdFor(A, C)), true);
  assert.deepEqual(await send({ from: C, to: A, kind: "text", text: "¿Hola?" }), { ok: false, error: "DECLINED" });
  assert.ok(!(await inbox(A)).some((row) => row.other === C));
});

test("통화 기록은 방 하나에 한 번", async () => {
  assert.equal(await claimCallLog("room01"), true);
  assert.equal(await claimCallLog("room01"), false);
});

test("집기: 글 메시지와 통화 기록의 한 줄만 인용, 인용 글은 저장된 말에서", async () => {
  const D = "lb_" + "d".repeat(24);
  const E = "lb_" + "e".repeat(24);
  const first = await send({ from: D, to: E, kind: "text", text: "¿Quedamos mañana a las seis?" });
  assert.ok(first.ok);
  await send({ from: E, to: D, kind: "text", text: "はい！" });
  const id = threadIdFor(D, E);
  const quote = await findQuote(id, first.message.seq);
  assert.deepEqual(quote, { seq: first.message.seq, nickname: "", text: "¿Quedamos mañana a las seis?", accountId: D });
  const asked = await send({ from: E, to: D, kind: "text", text: "これ、どういう意味ですか？", quote: quote!, ask: true });
  assert.ok(asked.ok && asked.message.ask === true && asked.message.quote?.accountId === D);

  const log = await send({ from: D, to: E, kind: "callLog", text: "2", roomId: "abcdef", lines: [
    { from: D, nickname: "Lucía", text: "Me da igual" },
    { from: E, nickname: "Yuki", text: "じゃあ六時で" },
  ] });
  assert.ok(log.ok);
  assert.deepEqual(await findQuote(id, log.message.seq, 0), { seq: log.message.seq, index: 0, nickname: "Lucía", text: "Me da igual", accountId: D });
  assert.equal(await findQuote(id, log.message.seq), null);
  assert.equal(await findQuote(id, log.message.seq, 5), null);
  assert.equal(await findQuote(id, 9999), null);
});

test("내 목록에서 지우기: 나에게만 빠지고, 새 줄이 오면 다시 나오며 지우기 전 줄은 숨긴다", async () => {
  const D = "lb_" + "d".repeat(24);
  const E = "lb_" + "e".repeat(24);
  await send({ from: D, to: E, kind: "text", text: "¿Vamos al cine?" });
  await send({ from: E, to: D, kind: "text", text: "いいよ" });
  const id = threadIdFor(D, E);
  assert.equal(await hideThread(C, id), false); // 대화에 없는 사람은 못 지움
  assert.equal(await hideThread(D, id), true);
  assert.equal((await inbox(D)).some((row) => row.thread.id === id), false);
  assert.equal((await inbox(E)).some((row) => row.thread.id === id), true); // 상대 쪽은 그대로
  const before = await hiddenUpTo(D, id);
  await send({ from: E, to: D, kind: "text", text: "เจอกันกี่โมง" });
  assert.equal((await inbox(D)).some((row) => row.thread.id === id), true);
  const visible = (await readMessages(id)).filter((row) => row.seq > before);
  assert.deepEqual(visible.map((row) => row.text), ["เจอกันกี่โมง"]);
});

test("보낸 줄 지우기: 내 글만, 상대에게서도 빠지고 인용 글은 비운다", async () => {
  const F = "lb_" + "f".repeat(24);
  const G = "lb_" + "g".repeat(24);
  const first = await send({ from: F, to: G, kind: "text", text: "Hola, ¿qué tal?" });
  await send({ from: G, to: F, kind: "text", text: "元気だよ" });
  assert.ok(first.ok);
  if (!first.ok) return;
  const id = threadIdFor(F, G);
  const quoting = await send({ from: G, to: F, kind: "text", text: "それって？", quote: { seq: first.message.seq, nickname: "", text: "Hola", accountId: F } });
  assert.ok(quoting.ok);
  assert.deepEqual(await unsend(G, id, first.message.seq), { ok: false, error: "NOT_YOURS" });
  assert.equal((await unsend(F, id, first.message.seq)).ok, true);
  const gone = await readGone(id);
  const seen = withoutGone(await readMessages(id), gone);
  assert.equal(seen.some((row) => row.seq === first.message.seq), false);
  assert.equal(seen.find((row) => row.text === "それって？")?.quote?.text, "");
  assert.equal((await readThread(id))?.lastText, "それって？");
});
