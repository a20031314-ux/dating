import assert from "node:assert/strict";
import test from "node:test";
import { lastSeenMine } from "./dm.ts";

const rows = [
  { seq: 1, from: "me", kind: "text" as const },
  { seq: 2, from: "you", kind: "text" as const },
  { seq: 3, from: "me", kind: "text" as const },
  { seq: 4, from: "me", kind: "call" as const },
  { seq: 5, from: "me", kind: "text" as const },
];

test("상대가 읽은 내 글 중 가장 마지막 줄에만 읽음", () => {
  assert.equal(lastSeenMine(rows, "me", 0), 0);
  assert.equal(lastSeenMine(rows, "me", 2), 1);
  assert.equal(lastSeenMine(rows, "me", 4), 3); // 통화 요청 줄에는 붙지 않음
  assert.equal(lastSeenMine(rows, "me", 9), 5);
  assert.equal(lastSeenMine(rows, "you", 9), 2);
});
