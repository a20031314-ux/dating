import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * 로그인 토큰: 서버만 아는 비밀로 서명한 짧은 글.
 *
 * KV를 읽지 않고 확인할 수 있어야 한다. 사용량을 세는 `requestUserId`가
 * 동기 함수이고 거의 모든 요청 앞에 있기 때문 — 요청마다 KV를 한 번 더 읽게
 * 하지 않는다. 대신 로그아웃은 앱이 토큰을 버리는 것이고, 계정 삭제 뒤 남은
 * 토큰은 /api/account/me가 계정이 없다고 답해 앱이 지운다.
 *
 * 비밀: `AUTH_SECRET`이 있으면 그것, 없으면 KV 토큰에서 만든다(둘 다 서버만 앎).
 * 그래서 Vercel에 새 변수를 넣지 않아도 바로 동작한다. 둘 다 없으면(로컬에서
 * KV 없이) 개발용 고정값 — 운영에서는 로그인을 꺼 둔다.
 */

export type AuthClaims = {
  /** 계정 id. */
  accountId: string;
  /** 이 계정의 기록이 묶인 사용자 id(`rc:…` 또는 `acct:…`). */
  dataUserId: string;
  issuedAt: number;
};

const VERSION = 1;
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function secret(): string | null {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return explicit;
  const kvToken = (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  if (kvToken) return createHash("sha256").update(`languagebank-auth:${kvToken}`).digest("hex");
  if (process.env.NODE_ENV !== "production") return "languagebank-dev-only-secret";
  return null;
}

/**
 * 다른 용도의 서명 키(예: 광고 보상 표 "adReward"). 로그인 토큰과 같은 키를 쓰면 한쪽 토큰이
 * 다른 쪽에서 통하므로, 용도 이름을 섞어 따로 만든다.
 */
export function purposeSecret(purpose: string): string | null {
  const key = secret();
  return key ? createHmac("sha256", key).update(`purpose:${purpose}`).digest("hex") : null;
}

export function authConfigured(): boolean {
  return secret() !== null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function issueAuthToken(
  claims: Omit<AuthClaims, "issuedAt">,
  now: number = Date.now(),
): string | null {
  const key = secret();
  if (!key) return null;
  const body = b64url(
    JSON.stringify({ v: VERSION, a: claims.accountId, u: claims.dataUserId, t: Math.floor(now / 1000) }),
  );
  return `${body}.${sign(body, key)}`;
}

export function verifyAuthToken(token: string | null | undefined, now: number = Date.now()): AuthClaims | null {
  if (!token || token.length > 600) return null;
  const key = secret();
  if (!key) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body, key));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      v?: unknown;
      a?: unknown;
      u?: unknown;
      t?: unknown;
    };
    if (parsed.v !== VERSION) return null;
    if (typeof parsed.a !== "string" || typeof parsed.u !== "string" || typeof parsed.t !== "number") return null;
    if (!parsed.a || !parsed.u) return null;
    const age = Math.floor(now / 1000) - parsed.t;
    if (age < -300 || age > MAX_AGE_SECONDS) return null;
    return { accountId: parsed.a, dataUserId: parsed.u, issuedAt: parsed.t };
  } catch {
    return null;
  }
}
