import assert from "node:assert/strict";
import test from "node:test";
import {
  kvConfigured,
  kvGetJson,
  kvGetNumber,
  kvIncrBy,
  kvSetJson,
} from "./kv.ts";

const URL_VAR = "KV_REST_API_URL";
const TOKEN_VAR = "KV_REST_API_TOKEN";

/** Nothing listens on port 1, so every command fails at connect. */
function pointAtNothing() {
  process.env[URL_VAR] = "http://127.0.0.1:1";
  process.env[TOKEN_VAR] = "not-a-real-token";
}

function pointAtNowhere() {
  delete process.env[URL_VAR];
  delete process.env[TOKEN_VAR];
}

async function withoutErrorLogs<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

test("with no credentials it stores in memory and says it is not configured", async () => {
  pointAtNowhere();
  assert.equal(kvConfigured(), false);

  await kvSetJson("memory-key", { hello: "world" });
  assert.deepEqual(await kvGetJson<{ hello: string }>("memory-key"), {
    hello: "world",
  });

  assert.equal(await kvIncrBy("memory-counter", 2), 2);
  assert.equal(await kvIncrBy("memory-counter", 3), 5);
  assert.equal(await kvGetNumber("memory-counter"), 5);
});

test("an expired in-memory row reads as absent", async () => {
  pointAtNowhere();
  await kvSetJson("expiring", { v: 1 }, -1);
  assert.equal(await kvGetJson("expiring"), null);
});

// The regression these guard against: the store used to throw on failure, and
// the chat route reads a counter outside its try block — so an unreachable KV
// turned every chat request into a 500. Counting usage must never be able to
// end the request it is counting.
test("an unreachable store reads as no usage instead of throwing", async () => {
  pointAtNothing();
  assert.equal(kvConfigured(), true);

  await withoutErrorLogs(async () => {
    assert.equal(await kvGetNumber("anything"), 0);
    assert.equal(await kvGetJson("anything"), null);
  });
});

test("an unreachable store makes a write a no-op instead of throwing", async () => {
  pointAtNothing();
  await withoutErrorLogs(async () => {
    await kvSetJson("anything", { a: 1 });
    assert.equal(await kvIncrBy("anything", 1), 0);
  });
});
