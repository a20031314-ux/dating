import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADULT_AGE,
  AGE_MAX,
  cleanWant,
  discoverOrder,
  isBirthYear,
  isPhotoDataUrl,
  mutualFit,
  wants,
  yearAge,
  type DatingProfile,
} from "./rules.ts";

const NOW = Date.UTC(2026, 10, 6);

function person(over: Partial<DatingProfile> = {}): DatingProfile {
  return {
    gender: "m",
    birthYear: 1996,
    region: "seoul",
    want: { genders: ["f"], ageMin: 25, ageMax: 35, regions: [] },
    photos: ["aaaaaaaaaaaa"],
    visible: true,
    updatedAt: NOW,
    ...over,
  };
}

test("나이는 연 나이 — 올해 19세가 되는 해부터 성인", () => {
  assert.equal(yearAge(2007, NOW), 19);
  assert.equal(isBirthYear(2007, NOW), true);
  assert.equal(isBirthYear(2008, NOW), false, "2026년에 18세");
  assert.equal(isBirthYear(2026 - AGE_MAX - 1, NOW), false);
  assert.equal(isBirthYear(1996.5, NOW), false);
  assert.equal(isBirthYear("1996", NOW), false);
});

test("조건 정리: 틀린 값은 기본값, 뒤집힌 나이는 바로잡음", () => {
  const want = cleanWant({ genders: ["f", "f", "x"], ageMin: 40, ageMax: 22, regions: ["busan", "mars"] });
  assert.deepEqual(want, { genders: ["f"], ageMin: 22, ageMax: 40, regions: ["busan"] });
  // 성별을 안 고르면 내 성별의 반대가 기본.
  assert.deepEqual(cleanWant({}, { gender: "f" }).genders, ["m"]);
  assert.deepEqual(cleanWant(null).genders, ["m", "f"]);
  // 나이는 성인 ~ 상한 안으로.
  const clamped = cleanWant({ ageMin: 10, ageMax: 200 });
  assert.equal(clamped.ageMin, ADULT_AGE);
  assert.equal(clamped.ageMax, AGE_MAX);
});

test("조건 맞추기: 성별·나이·지역, 추천은 양쪽 다 맞아야", () => {
  const me = person();
  const her = person({ gender: "f", birthYear: 1998, region: "busan", want: { genders: ["m"], ageMin: 28, ageMax: 40, regions: [] } });
  assert.equal(wants(me, her, NOW), true);
  assert.equal(wants(her, me, NOW), true, "나는 30세");
  assert.equal(mutualFit(me, her, NOW), true);

  // 그녀가 서울·부산 밖만 원하면 안 맞음.
  const picky = { ...her, want: { ...her.want, regions: ["daegu" as const] } };
  assert.equal(mutualFit(me, picky, NOW), false);
  // 내가 찾는 나이 밖.
  assert.equal(wants(me, person({ gender: "f", birthYear: 1985 }), NOW), false);
  // 성별이 안 맞음.
  assert.equal(wants(me, person({ gender: "m" }), NOW), false);
});

test("추천 순서: 같은 지역 먼저, 그다음 최근 접속", () => {
  const order = discoverOrder({ region: "seoul" }, [
    { id: "far-new", profile: { region: "busan" }, activeAt: 300 },
    { id: "near-old", profile: { region: "seoul" }, activeAt: 100 },
    { id: "near-new", profile: { region: "seoul" }, activeAt: 200 },
  ]);
  assert.deepEqual(order, ["near-new", "near-old", "far-new"]);
});

test("사진은 이미지 data URL만", () => {
  assert.equal(isPhotoDataUrl("data:image/jpeg;base64,AAAA"), true);
  assert.equal(isPhotoDataUrl("data:image/svg+xml;base64,AAAA"), false);
  assert.equal(isPhotoDataUrl("https://example.com/a.jpg"), false);
  assert.equal(isPhotoDataUrl(`data:image/jpeg;base64,${"A".repeat(200_000)}`), false);
});
