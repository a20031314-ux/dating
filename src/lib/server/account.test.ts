import assert from "node:assert/strict";
import test from "node:test";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.AUTH_SECRET;

const { issueAuthToken, verifyAuthToken } = await import("./authToken.ts");
const { readTokenInfo } = await import("./googleIdToken.ts");
const { letterFor, supportedLetterLocales } = await import("./emailSender.ts");
const store = await import("./accountStore.ts");
const { kvListRange } = await import("./kv.ts");
const shared = await import("../account/shared.ts");
const { keyBelongsTo, purgeDeletedAccounts } = await import("./accountPurge.ts");
const { kvSetJson, kvGetJson } = await import("./kv.ts");

const originalWarn = console.warn;
console.warn = () => {};
test.after(() => {
  console.warn = originalWarn;
});

test("토큰: 발급한 것은 읽히고, 고치거나 오래된 것은 안 읽힌다", () => {
  const now = Date.UTC(2026, 9, 18);
  const token = issueAuthToken({ accountId: "lb_" + "a".repeat(24), dataUserId: "rc:$RCAnonymousID:abc" }, now);
  assert.ok(token);
  const claims = verifyAuthToken(token, now + 1000);
  assert.equal(claims?.dataUserId, "rc:$RCAnonymousID:abc");
  assert.equal(claims?.accountId, "lb_" + "a".repeat(24));

  const [body, sig] = token!.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 1, a: "lb_x", u: "rc:someone-else", t: now / 1000 })).toString("base64url");
  assert.equal(verifyAuthToken(`${forged}.${sig}`, now), null);
  assert.equal(verifyAuthToken(`${body}.${sig.slice(0, -2)}xx`, now), null);
  assert.equal(verifyAuthToken(token, now + 401 * 24 * 60 * 60 * 1000), null);
  assert.equal(verifyAuthToken("", now), null);
  assert.equal(verifyAuthToken(null, now), null);
});

test("토큰: 다른 비밀로 서명한 것은 안 읽힌다", () => {
  const token = issueAuthToken({ accountId: "lb_" + "b".repeat(24), dataUserId: "acct:x" });
  process.env.AUTH_SECRET = "another-secret";
  try {
    assert.equal(verifyAuthToken(token), null);
  } finally {
    delete process.env.AUTH_SECRET;
  }
});

test("Google tokeninfo: 우리 앱·Google 발급·확인된 메일만", () => {
  const now = 1_800_000_000;
  const good = { aud: "web-id", iss: "https://accounts.google.com", sub: "1234567890", email: "Mina@Gmail.com", email_verified: "true", name: "Mina", exp: String(now + 60) };
  assert.deepEqual(readTokenInfo(good, ["web-id"], now), { sub: "1234567890", email: "mina@gmail.com", name: "Mina" });
  assert.equal(readTokenInfo({ ...good, aud: "other" }, ["web-id"], now), null);
  assert.equal(readTokenInfo({ ...good, iss: "evil.example" }, ["web-id"], now), null);
  assert.equal(readTokenInfo({ ...good, exp: String(now - 1) }, ["web-id"], now), null);
  assert.equal(readTokenInfo({ ...good, email_verified: "false" }, ["web-id"], now)?.email, null);
});

test("프로필 입력 정리: 글자 수는 보이는 글자로, 한국어·일본어·태국어·스페인어", () => {
  assert.equal(shared.cleanNickname("  민지\n  ☕️  "), "민지 ☕️");
  assert.equal(shared.visibleLength("👩‍👩‍👧"), 1);
  assert.equal(shared.visibleLength("สวัสดี"), 4); // 태국어 모음 기호는 앞 글자에 붙는다
  assert.equal(shared.cleanNickname("あ".repeat(30)).length, shared.NICKNAME_MAX);
  assert.equal(shared.cleanNickname("José Martínez"), "José Martínez");
  assert.equal(shared.cleanBio("한 줄\n\n\n\n두 줄"), "한 줄\n\n두 줄");
  assert.equal(shared.visibleLength(shared.cleanBio("ก".repeat(500))), shared.BIO_MAX);
  assert.equal(shared.cleanNickname(42), "");
});

test("이메일·사진·코드 검사", () => {
  assert.equal(shared.normalizeEmail(" Mina@Example.COM "), "mina@example.com");
  assert.equal(shared.normalizeEmail("mina@example"), null);
  assert.equal(shared.normalizeEmail("no at sign"), null);
  assert.equal(shared.cleanPhoto("data:image/jpeg;base64,AAAA"), "data:image/jpeg;base64,AAAA");
  assert.equal(shared.cleanPhoto("data:image/svg+xml;base64,AAAA"), null);
  assert.equal(shared.cleanPhoto("data:image/jpeg;base64," + "A".repeat(200_000)), null);
  assert.ok(shared.isEmailCode("012345"));
  assert.ok(!shared.isEmailCode("12345"));
});

test("코드 메일: 14개 언어 모두 코드와 시간이 들어간다", () => {
  const locales = supportedLetterLocales();
  assert.equal(locales.length, 14);
  for (const locale of locales) {
    const letter = letterFor(locale, "482913", 10);
    assert.ok(letter.subject.includes("482913"), locale);
    assert.ok(letter.body.includes("482913") && letter.body.includes("10"), locale);
    assert.ok(!letter.body.includes("{"), locale);
  }
  assert.equal(letterFor("xx", "1", 10).subject, letterFor("en", "1", 10).subject);
});

test("이메일 계정: 처음엔 이 기기 기록을 계정에 묶고, 다음 기기는 같은 계정", async () => {
  const first = await store.findOrCreateAccount({ kind: "email", email: "a@example.com" }, "rc:device-a");
  assert.equal(first.created, true);
  assert.equal(first.account.dataUserId, "rc:device-a");

  const again = await store.findOrCreateAccount({ kind: "email", email: "a@example.com" }, "rc:device-b");
  assert.equal(again.created, false);
  assert.equal(again.account.id, first.account.id);
  assert.equal(again.account.dataUserId, "rc:device-a");
});

test("기록 없는 기기(웹)는 계정 자신의 id로 시작", async () => {
  const { account } = await store.findOrCreateAccount({ kind: "email", email: "web@example.com" }, "local-anonymous");
  assert.equal(account.dataUserId, `acct:${account.id}`);
});

test("Google로 로그인해도 같은 메일의 이메일 계정과 이어진다", async () => {
  const email = await store.findOrCreateAccount({ kind: "email", email: "same@example.com" }, "rc:p");
  const google = await store.findOrCreateAccount({ kind: "google", sub: "99999", email: "same@example.com", name: "Same" }, "rc:q");
  assert.equal(google.account.id, email.account.id);
  assert.equal(google.account.googleSub, "99999");
  const viaSub = await store.findOrCreateAccount({ kind: "google", sub: "99999", email: null, name: null }, "rc:r");
  assert.equal(viaSub.account.id, email.account.id);
});

test("새 Google 계정은 이름을 닉네임으로", async () => {
  const { account } = await store.findOrCreateAccount({ kind: "google", sub: "11111", email: null, name: "다은" }, "rc:z");
  assert.equal(account.profile.nickname, "다은");
});

test("프로필 저장·사진 넣고 빼기·삭제", async () => {
  const { account } = await store.findOrCreateAccount({ kind: "email", email: "p@example.com" }, "rc:prof");
  const withPhoto = await store.saveProfile(account, { nickname: "Ana", bio: "Aprendo coreano.", photo: "data:image/jpeg;base64,AAAA" });
  const pub = await store.toPublic(withPhoto);
  assert.equal(pub.profile.photo, "data:image/jpeg;base64,AAAA");
  assert.equal(pub.profile.bio, "Aprendo coreano.");

  const kept = await store.saveProfile(withPhoto, { nickname: "Ana", bio: "" });
  assert.equal((await store.toPublic(kept)).profile.photo, "data:image/jpeg;base64,AAAA");
  const removed = await store.saveProfile(kept, { nickname: "Ana", bio: "", photo: null });
  assert.equal((await store.toPublic(removed)).profile.photo, null);

  await store.deleteAccount(removed);
  assert.equal(await store.readAccount(removed.id), null);
  const fresh = await store.findOrCreateAccount({ kind: "email", email: "p@example.com" }, "rc:prof2");
  assert.equal(fresh.created, true);
  assert.ok((await kvListRange(store.PURGE_QUEUE_KEY)).includes("rc:prof"));
});

test("읽음 표시: 기본 켬, 끄면 표시·키, 다른 칸만 저장해도 그대로, 켜면 키 지움, 계정 지우면 키도", async () => {
  const { account } = await store.findOrCreateAccount({ kind: "email", email: "rr@example.com" }, "rc:rr");
  assert.equal((await store.toPublic(account)).profile.readReceipts, true);
  const off = await store.saveProfile(account, { nickname: "Yuki", bio: "", readReceipts: false });
  assert.equal((await store.toPublic(off)).profile.readReceipts, false);
  assert.deepEqual(await store.readReceiptsOff([off.id, "lb_" + "9".repeat(24)]), [true, false]);
  const kept = await store.saveProfile(off, { nickname: "Yuki", bio: "こんにちは" });
  assert.equal((await store.toPublic(kept)).profile.readReceipts, false);
  const on = await store.saveProfile(kept, { nickname: "Yuki", bio: "", readReceipts: true });
  assert.equal((await store.toPublic(on)).profile.readReceipts, true);
  assert.deepEqual(await store.readReceiptsOff([on.id]), [false]);
  const offAgain = await store.saveProfile(on, { nickname: "Yuki", bio: "", readReceipts: false });
  await store.deleteAccount(offAgain);
  assert.deepEqual(await store.readReceiptsOff([offAgain.id]), [false]);
});

test("이메일 코드: 맞으면 한 번만, 틀리면 다섯 번에 막힘, 한 시간 다섯 번 발송", async () => {
  const code = await store.createEmailCode("c@example.com");
  assert.ok(code && shared.isEmailCode(code));
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal(await store.checkEmailCode("c@example.com", wrong), "wrong");
  assert.equal(await store.checkEmailCode("c@example.com", code!), "ok");
  assert.equal(await store.checkEmailCode("c@example.com", code!), "expired");

  const second = await store.createEmailCode("c@example.com");
  const bad = second === "000000" ? "111111" : "000000";
  for (let i = 0; i < store.EMAIL_CODE_ATTEMPTS - 1; i += 1) {
    assert.equal(await store.checkEmailCode("c@example.com", bad), "wrong");
  }
  assert.equal(await store.checkEmailCode("c@example.com", bad), "locked");
  assert.equal(await store.checkEmailCode("c@example.com", second!), "expired");

  for (let i = 2; i < store.EMAIL_SENDS_PER_HOUR; i += 1) assert.ok(await store.createEmailCode("c@example.com"));
  assert.equal(await store.createEmailCode("c@example.com"), null);
});

test("지운 계정 기록 지우기: 그 id 조각이 든 키만", async () => {
  assert.ok(keyBelongsTo("learnerProfile:v1:rc:abc:ja", "rc:abc"));
  assert.ok(!keyBelongsTo("learnerProfile:v1:rc:abcd:ja", "rc:abc"));
  assert.ok(keyBelongsTo("usage:chat:rc:abc", "rc:abc"));

  const { account } = await store.findOrCreateAccount({ kind: "email", email: "gone@example.com" }, "rc:gone1");
  await kvSetJson("ledger:v1:rc:gone1:ja", { a: 1 });
  await kvSetJson("ledger:v1:rc:gone10:ja", { a: 2 });
  await store.deleteAccount(account);
  const preview = await purgeDeletedAccounts({ apply: false });
  assert.equal(preview.preview, true);
  assert.ok(await kvGetJson("ledger:v1:rc:gone1:ja"));
  await purgeDeletedAccounts({ apply: true });
  assert.equal(await kvGetJson("ledger:v1:rc:gone1:ja"), null);
  assert.deepEqual(await kvGetJson("ledger:v1:rc:gone10:ja"), { a: 2 });
  assert.equal((await kvListRange(store.PURGE_QUEUE_KEY)).length, 0);
});

test("아이디 규칙: 소문자로 맞추고, 4~20자, 영문·숫자·_ .", () => {
  assert.equal(shared.normalizeUsername(" Minji_01 "), "minji_01");
  assert.equal(shared.normalizeUsername("abc"), null);
  assert.equal(shared.normalizeUsername("a".repeat(21)), null);
  assert.equal(shared.normalizeUsername("_minji"), null);
  assert.equal(shared.normalizeUsername("민지민지"), null);
  assert.equal(shared.normalizeUsername("josé"), null);
  assert.ok(shared.isPasswordOk("12345678"));
  assert.ok(!shared.isPasswordOk("1234567"));
  assert.ok(!shared.isPasswordOk("x".repeat(129)));
});

test("비밀번호 해시: 원문이 남지 않고, 맞는 것만 통과, 한국어·태국어 비밀번호도", async () => {
  const hash = await store.hashPassword("비밀번호ขอบคุณ1");
  assert.ok(!hash.includes("비밀번호"));
  assert.ok(hash.startsWith("scrypt$"));
  assert.ok(await store.verifyPassword("비밀번호ขอบคุณ1", hash));
  assert.ok(!(await store.verifyPassword("비밀번호ขอบคุณ2", hash)));
  assert.notEqual(await store.hashPassword("same-pass"), await store.hashPassword("same-pass"));
});

test("아이디 가입·로그인: 중복 막고, 없는 아이디와 틀린 비밀번호는 같은 답, 10번 틀리면 막힘", async () => {
  const made = await store.createPasswordAccount("minji_01", "correct-horse", "rc:pw-device");
  assert.ok("account" in made);
  if (!("account" in made)) return;
  assert.equal(made.account.dataUserId, "rc:pw-device");
  assert.equal((await store.toPublic(made.account)).username, "minji_01");
  assert.ok(!JSON.stringify(await store.toPublic(made.account)).includes("scrypt"));

  assert.deepEqual(await store.createPasswordAccount("minji_01", "another-pass", "rc:other"), { error: "USERNAME_TAKEN" });

  const ok = await store.loginWithPassword("minji_01", "correct-horse");
  assert.ok("account" in ok && ok.account.id === made.account.id);
  assert.deepEqual(await store.loginWithPassword("minji_01", "wrong-pass"), { error: "WRONG_PASSWORD" });
  assert.deepEqual(await store.loginWithPassword("nobody_here", "correct-horse"), { error: "WRONG_PASSWORD" });

  for (let i = 1; i < store.PASSWORD_FAILS_PER_HOUR; i += 1) await store.loginWithPassword("minji_01", "wrong-pass");
  assert.deepEqual(await store.loginWithPassword("minji_01", "correct-horse"), { error: "TOO_MANY_TRIES" });
});

test("비밀번호 바꾸기와 계정 삭제 뒤 아이디를 다시 쓸 수 있음", async () => {
  const made = await store.createPasswordAccount("yuki.k", "first-pass", "rc:pw2");
  if (!("account" in made)) throw new Error("가입 실패");
  assert.equal(await store.changePassword(made.account, "wrong", "second-pass"), "WRONG_PASSWORD");
  assert.equal(await store.changePassword(made.account, "first-pass", "second-pass"), "ok");
  const after = await store.loginWithPassword("yuki.k", "second-pass");
  assert.ok("account" in after);
  if (!("account" in after)) return;
  await store.deleteAccount(after.account);
  assert.deepEqual(await store.loginWithPassword("yuki.k", "second-pass"), { error: "WRONG_PASSWORD" });
  assert.ok("account" in (await store.createPasswordAccount("yuki.k", "third-pass", "rc:pw3")));
});
