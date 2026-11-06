import assert from "node:assert/strict";
import test from "node:test";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const { forgetPresence, recentPeople, touchPresence } = await import("./presenceStore.ts");
const { kvZRevRange } = await import("./kv.ts");

const originalWarn = console.warn;
console.warn = () => {};
test.after(() => {
  console.warn = originalWarn;
});

const DAY = 24 * 60 * 60 * 1000;
const a = "lb_" + "a".repeat(24);
const b = "lb_" + "b".repeat(24);
const c = "lb_" + "c".repeat(24);

test("최근에 본 사람부터, 기간 밖은 빼고, 언어를 함께", async () => {
  const now = Date.UTC(2026, 9, 18, 13);
  await touchPresence(a, { learn: "ja", ui: "ko" }, now - 20 * DAY);
  await touchPresence(b, { learn: "ko", ui: "ja" }, now - 2 * DAY);
  await touchPresence(c, { learn: "es", ui: "ar" }, now - 60_000 * 3);
  const rows = await recentPeople(10, now - 14 * DAY);
  assert.deepEqual(rows.map((row) => row.id), [c, b]);
  assert.equal(rows.at(0)?.presence.ui, "ar");
  assert.equal(rows.at(1)?.presence.learn, "ko");
});

test("언어를 안 보내면 지난 값을 두고, 이상한 값은 받지 않는다", async () => {
  const now = Date.UTC(2026, 9, 18, 14);
  await touchPresence(b, {}, now);
  await touchPresence(b, { learn: "<script>", ui: 3 }, now + 120_000);
  const row = (await recentPeople(10, 0)).find((person) => person.id === b);
  assert.equal(row?.presence.learn, "ko");
  assert.equal(row?.presence.ui, "ja");
  assert.equal(row?.presence.at, now + 120_000);
});

test("1분 안에 다시 불러도 시각은 그대로(쓰기 줄이기), 언어가 바뀌면 바로", async () => {
  const now = Date.UTC(2026, 9, 18, 15);
  await touchPresence(c, { learn: "es", ui: "ar" }, now);
  await touchPresence(c, { learn: "es", ui: "ar" }, now + 30_000);
  assert.equal((await recentPeople(10, 0)).find((p) => p.id === c)?.presence.at, now);
  await touchPresence(c, { learn: "th", ui: "ar" }, now + 40_000);
  const row = (await recentPeople(10, 0)).find((p) => p.id === c);
  assert.equal(row?.presence.learn, "th");
  assert.equal(row?.presence.at, now + 40_000);
});

test("계정을 지우면 목록에서 빠진다", async () => {
  await forgetPresence(c);
  assert.ok(!(await recentPeople(10, 0)).some((p) => p.id === c));
  const all = await kvZRevRange("social:v1:active", 0, -1);
  assert.ok(all.length >= 2);
  assert.ok(!all.some((row) => row.member === c));
});
