import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMeetInput, hasBlockedText, isOpen, seatLeft, MEET_OPEN_AFTER_MS } from "./rules.ts";

const NOW = Date.UTC(2026, 10, 6, 12);
const HOUR = 60 * 60 * 1000;
const good = {
  region: "seoul",
  area: "  홍대입구  ",
  place: "와우산로 OO포차 2층",
  at: NOW + 3 * HOUR,
  seats: { kind: "ratio", m: 2, f: 2 },
  cost: "split",
  note: "가볍게 한잔해요",
};

test("모집글: 맞는 값은 정리해서 받는다", () => {
  const result = cleanMeetInput(good, "m", NOW);
  assert.ok("ok" in result);
  assert.equal(result.ok.area, "홍대입구");
  assert.deepEqual(result.ok.seats, { kind: "ratio", m: 2, f: 2 });
});

test("모집글: 시각·자리·비용·지역이 틀리면 거절", () => {
  assert.deepEqual(cleanMeetInput({ ...good, at: NOW - HOUR }, "m", NOW), { error: "BAD_TIME" });
  assert.deepEqual(cleanMeetInput({ ...good, at: NOW + 8 * 24 * HOUR }, "m", NOW), { error: "BAD_TIME" });
  assert.deepEqual(cleanMeetInput({ ...good, seats: { kind: "any", total: 1 } }, "m", NOW), { error: "BAD_SEATS" });
  assert.deepEqual(cleanMeetInput({ ...good, seats: { kind: "any", total: 11 } }, "m", NOW), { error: "BAD_SEATS" });
  // 성비 자리면 방장 자리가 있어야.
  assert.deepEqual(cleanMeetInput({ ...good, seats: { kind: "ratio", m: 0, f: 3 } }, "m", NOW), { error: "BAD_SEATS" });
  assert.deepEqual(cleanMeetInput({ ...good, cost: "남자가 냄" }, "m", NOW), { error: "BAD_COST" });
  assert.deepEqual(cleanMeetInput({ ...good, region: "tokyo" }, "m", NOW), { error: "BAD_REGION" });
  assert.deepEqual(cleanMeetInput({ ...good, place: " " }, "m", NOW), { error: "BAD_PLACE" });
});

test("모집글: 금액·유료 만남 표현은 받지 않는다", () => {
  assert.equal(hasBlockedText("1인 3만원"), true);
  assert.equal(hasBlockedText("20,000 원씩"), true);
  assert.equal(hasBlockedText("조건 만남"), true);
  assert.equal(hasBlockedText("용돈 드려요"), true);
  assert.equal(hasBlockedText("11시 홍대 포차 4명"), false);
  assert.equal(hasBlockedText("2차는 노래방"), false);
  assert.deepEqual(cleanMeetInput({ ...good, note: "여자분은 5만원 드려요" }, "m", NOW), { error: "BLOCKED_TEXT" });
});

test("자리: 성비면 성별마다, 아니면 합계", () => {
  const ratio = { kind: "ratio" as const, m: 2, f: 2 };
  assert.equal(seatLeft(ratio, { m: 2, f: 1 }, "m"), false);
  assert.equal(seatLeft(ratio, { m: 2, f: 1 }, "f"), true);
  const any = { kind: "any" as const, total: 3 };
  assert.equal(seatLeft(any, { m: 2, f: 0 }, "m"), true);
  assert.equal(seatLeft(any, { m: 2, f: 1 }, "f"), false);
});

test("모집 중: 닫음·시각 지남·자리 꽉 참이면 아님", () => {
  const meet = { at: NOW, seats: { kind: "any" as const, total: 4 } };
  assert.equal(isOpen(meet, { m: 1, f: 1 }, NOW), true);
  assert.equal(isOpen(meet, { m: 1, f: 1 }, NOW + MEET_OPEN_AFTER_MS + 1), false);
  assert.equal(isOpen({ ...meet, closed: true }, { m: 1, f: 1 }, NOW), false);
  assert.equal(isOpen(meet, { m: 2, f: 2 }, NOW), false);
});
