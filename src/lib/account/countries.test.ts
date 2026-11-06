import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRY_CODES, countryFlag, countryName, isCountryCode } from "./countries.ts";

test("국기 이모지는 지역 표시 문자 두 개", () => {
  assert.equal(countryFlag("KR"), "🇰🇷");
  assert.equal(countryFlag("BR"), "🇧🇷");
  assert.equal(countryFlag("XX"), "");
  assert.equal(countryFlag(null), "");
});

test("나라 이름은 앱 언어로(태국어·스페인어), 코드는 중복 없이", () => {
  assert.equal(countryName("JP", "es"), "Japón");
  assert.equal(countryName("KR", "th"), "เกาหลีใต้");
  assert.equal(new Set(COUNTRY_CODES).size, COUNTRY_CODES.length);
  assert.ok(isCountryCode("XK"));
  assert.ok(!isCountryCode("kr"));
});
