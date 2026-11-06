import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_LIKES, type DatingProfile } from "../dating/rules.ts";
import { threadIdFor } from "../rooms/dm.ts";
import { readThread, send } from "./dmStore.ts";
import {
  addPhoto,
  discover,
  forgetDating,
  isMatched,
  like,
  likedMe,
  likesLeft,
  pass,
  readDatingProfile,
  readMatches,
  removePhoto,
  reorderPhotos,
  saveDatingProfile,
  unmatch,
} from "./datingStore.ts";

// KV 접속 정보 없이 메모리로(kv.ts).
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const id = (c: string) => "lb_" + c.repeat(24);
const MAN = id("1");
const WOMAN = id("2");
const WOMAN_FAR = id("3");
const MAN_2 = id("4");
const PHOTO = "data:image/jpeg;base64,AAAA";
const noBlock = async () => false;

function profile(over: Partial<DatingProfile>): DatingProfile {
  return {
    gender: "m",
    birthYear: 1996,
    region: "seoul",
    want: { genders: ["f"], ageMin: 19, ageMax: 50, regions: [] },
    photos: [],
    visible: true,
    updatedAt: 0,
    ...over,
  };
}

async function setUp(account: string, over: Partial<DatingProfile>) {
  await saveDatingProfile(account, profile(over));
  const added = await addPhoto(account, PHOTO);
  assert.ok("ok" in added);
}

test("사진: 더하기·순서·지우기, 사진이 없으면 추천에 안 나온다", async () => {
  const someone = id("9");
  await saveDatingProfile(someone, profile({ gender: "f", want: { genders: ["m"], ageMin: 19, ageMax: 50, regions: [] } }));
  await setUp(MAN, {});
  // 사진 없는 사람은 후보에 없음.
  assert.deepEqual(await discover({ me: MAN, profile: (await readDatingProfile(MAN))!, limit: 10, blocked: noBlock }), []);

  const first = await addPhoto(someone, PHOTO);
  const second = await addPhoto(someone, PHOTO);
  assert.ok("ok" in first && "ok" in second);
  const [a, b] = second.ok.photos;
  const reordered = await reorderPhotos(someone, [b]);
  assert.ok("ok" in reordered);
  assert.deepEqual(reordered.ok.photos, [b, a]);
  const removed = await removePhoto(someone, b);
  assert.ok("ok" in removed);
  assert.deepEqual(removed.ok.photos, [a]);
  assert.deepEqual(await removePhoto(someone, "ffffffffffff"), { error: "NOT_FOUND" });
  await forgetDating(someone);
  assert.equal(await readDatingProfile(someone), null);
});

test("추천: 서로 조건 맞는 사람만, 같은 지역 먼저, 패스·차단은 빠짐", async () => {
  await setUp(WOMAN, { gender: "f", birthYear: 1998, want: { genders: ["m"], ageMin: 19, ageMax: 50, regions: [] } });
  await setUp(WOMAN_FAR, { gender: "f", birthYear: 1997, region: "busan", want: { genders: ["m"], ageMin: 19, ageMax: 50, regions: [] } });
  await setUp(MAN_2, { gender: "m" });
  const me = (await readDatingProfile(MAN))!;

  const ids = await discover({ me: MAN, profile: me, limit: 10, blocked: noBlock });
  assert.deepEqual(ids, [WOMAN, WOMAN_FAR], "남자는 안 나오고, 서울이 먼저");

  const blocked = await discover({ me: MAN, profile: me, limit: 10, blocked: async (other) => other === WOMAN });
  assert.deepEqual(blocked, [WOMAN_FAR]);

  await pass(MAN, WOMAN_FAR);
  assert.deepEqual(await discover({ me: MAN, profile: me, limit: 10, blocked: noBlock }), [WOMAN]);
});

test("좋아요: 한쪽이면 받은 좋아요에, 서로면 매칭 + 대화가 바로 열린다", async () => {
  const first = await like(WOMAN, MAN);
  assert.deepEqual(first, { ok: true, matched: false });
  assert.deepEqual(await likedMe(MAN), [WOMAN]);
  assert.equal(await isMatched(MAN, WOMAN), false);

  const second = await like(MAN, WOMAN);
  assert.ok(second.ok && second.matched);
  assert.equal(second.threadId, threadIdFor(MAN, WOMAN));
  assert.equal(await isMatched(MAN, WOMAN), true);
  assert.equal(await isMatched(WOMAN, MAN), true);
  assert.deepEqual(await likedMe(MAN), [], "매칭되면 받은 좋아요에서 빠짐");
  assert.deepEqual((await readMatches(WOMAN)).map((row) => row.id), [MAN]);

  // 요청 단계 없이 열린 대화 — 원본 dmStore 그대로.
  const thread = await readThread(threadIdFor(MAN, WOMAN));
  assert.equal(thread?.status, "open");
  const sent = await send({ from: WOMAN, to: MAN, kind: "text", text: "안녕하세요!" });
  assert.ok(sent.ok);

  // 매칭된 사람은 추천에 다시 안 나옴.
  assert.ok(!(await discover({ me: MAN, profile: (await readDatingProfile(MAN))!, limit: 10, blocked: noBlock })).includes(WOMAN));
});

test("매칭 끊기: 둘 다 목록에서 빠지고 다시 맞춰지지 않는다", async () => {
  await unmatch(MAN, WOMAN);
  assert.equal(await isMatched(MAN, WOMAN), false);
  assert.equal(await isMatched(WOMAN, MAN), false);
  // 예전 좋아요가 지워져서, 한쪽이 다시 눌러도 바로 매칭되지 않는다.
  const again = await like(WOMAN, MAN);
  assert.deepEqual(again, { ok: true, matched: false });
});

test("하루 좋아요 한도", async () => {
  const spammer = id("5");
  const day = Date.UTC(2026, 10, 6, 12);
  assert.equal(await likesLeft(spammer, day), DAILY_LIKES);
  for (let i = 0; i < DAILY_LIKES; i += 1) {
    const result = await like(spammer, "lb_" + String(i).padStart(24, "0"), day);
    assert.ok(result.ok);
  }
  assert.equal(await likesLeft(spammer, day), 0);
  assert.deepEqual(await like(spammer, MAN, day), { ok: false, error: "LIMIT" });
  // 다음 날 다시.
  assert.equal(await likesLeft(spammer, day + 24 * 60 * 60 * 1000), DAILY_LIKES);
  assert.deepEqual(await like(spammer, spammer, day), { ok: false, error: "SELF" });
});
