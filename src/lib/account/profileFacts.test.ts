import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanFacts,
  cleanShow,
  DEFAULT_SHOW,
  factsOf,
  factsPrompt,
  INTERESTS_MAX,
  learnsOf,
  mergeFacts,
  sharedInterests,
  speaksOf,
  showOf,
} from "./profileFacts.ts";

test("모르는 칩·중복·한도를 넘는 것은 버리고, 모국어는 할 수 있는 언어에서 뺀다", () => {
  const facts = cleanFacts({
    native: "th",
    speaks: ["th", "es", "es", "ja", "ar", "zh", "<b>"],
    interests: ["music", "music", "nope", "travel", "games", "cooking", "sports", "movies"],
    work: "student",
    meetModes: ["call", "fax"],
    meetTimes: ["night", 3],
  });
  assert.equal(facts.native, "th");
  // 할 수 있는 언어는 개수 제한 없음(2026-10-23, 그 전엔 3개).
  assert.deepEqual(facts.speaks, ["es", "ja", "ar", "zh"]);
  assert.equal(facts.interests.length, INTERESTS_MAX);
  assert.deepEqual(facts.interests.slice(0, 2), ["music", "travel"]);
  assert.equal(facts.work, "student");
  assert.deepEqual(facts.meetModes, ["call"]);
  assert.deepEqual(facts.meetTimes, ["night"]);
});

test("이상한 값은 빈 사실로", () => {
  assert.deepEqual(cleanFacts(null), factsOf(undefined));
  assert.equal(cleanFacts({ native: "korean", work: "ceo" }).native, null);
  assert.equal(cleanFacts({ work: "ceo" }).work, null);
});

test("칸 켬/끔: 처음 값은 도움·꾸준함·목표·함께 만든 사람만 켬, 보낸 칸만 바뀐다", () => {
  assert.equal(DEFAULT_SHOW.topics, false);
  assert.equal(DEFAULT_SHOW.phrases, false);
  assert.equal(DEFAULT_SHOW.help, true);
  const changed = cleanShow({ help: false, topics: "yes" }, { streak: false });
  assert.equal(changed.help, false);
  assert.equal(changed.streak, false);
  assert.equal(changed.topics, false);
  assert.equal(changed.goal, true);
  assert.deepEqual(showOf(undefined), DEFAULT_SHOW);
});

test("겹치는 관심사 수", () => {
  assert.equal(sharedInterests(["music", "travel", "games"], ["games", "music", "books"]), 2);
  assert.equal(sharedInterests([], ["music"]), 0);
});

test("튜터 줄: 관심사·하는 일이 있을 때만, 튜터 사용을 끄면 비어 있다", () => {
  const facts = cleanFacts({ interests: ["cooking", "anime"], work: "worker" });
  const line = factsPrompt(facts, DEFAULT_SHOW);
  assert.match(line, /cooking, anime/);
  assert.match(line, /worker/);
  assert.match(line, /do not ask/);
  assert.equal(factsPrompt(facts, { ...DEFAULT_SHOW, tutor: false }), "");
  assert.equal(factsPrompt(cleanFacts({ native: "ko" }), DEFAULT_SHOW), "");
});

test("국적: 두 글자 나라 코드만(소문자도 받아 대문자로), 역사 속·예약 코드는 버림", () => {
  assert.equal(cleanFacts({ country: "kr" }).country, "KR");
  assert.equal(cleanFacts({ country: "TH" }).country, "TH");
  assert.equal(cleanFacts({ country: "SU" }).country, null);
  assert.equal(cleanFacts({ country: "EU" }).country, null);
  assert.equal(cleanFacts({ country: "Korea" }).country, null);
});

test("배우는 언어: 개수 제한 없이, 모국어는 빼고, 예전 앱이 저장해도 지워지지 않는다", () => {
  const many = ["ja", "zh", "th", "es", "fr", "it", "pt", "ru", "id", "ar", "hi", "vi", "en"];
  const facts = cleanFacts({ native: "ko", learns: ["ko", ...many, "ja"] });
  assert.deepEqual(facts.learns, many);
  // 2.72 이하 앱은 learns 칸 없이 facts를 보낸다 → 저장된 배우는 언어를 남긴다(모국어가 바뀌면 그건 뺀다).
  const kept = mergeFacts({ native: "ja", speaks: ["en"] }, { ...facts });
  assert.deepEqual(kept.learns, many.filter((code) => code !== "ja"));
  // 새 앱이 비운 목록을 보내면 비운다.
  assert.deepEqual(mergeFacts({ native: "ko", learns: [] }, facts).learns, []);
  assert.deepEqual(mergeFacts({ native: "ko" }, undefined).learns, []);
});

test("배우는 언어·쓰는 말: 프로필이 비면 접속 기록(앱 설정)으로 대신", () => {
  assert.deepEqual(learnsOf({ learns: ["ar"] }, "ja"), ["ar"]);
  assert.deepEqual(learnsOf({ learns: [] }, "ja"), ["ja"]);
  assert.deepEqual(learnsOf({ learns: [] }, null), []);
  assert.deepEqual(speaksOf({ native: "ko", speaks: ["en"] }, "ja"), ["ko", "en"]);
  assert.deepEqual(speaksOf({ native: null, speaks: [] }, "es"), ["es"]);
});
