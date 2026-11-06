/**
 * Google 로그인 ID 토큰 확인.
 *
 * Google의 tokeninfo 엔드포인트가 서명·만료를 확인해 준다. 여기서는 그 답이
 * 우리 앱에 발급된 것(aud)이고 Google이 낸 것(iss)인지만 본다. 라이브러리 없이
 * fetch 한 번 — 로그인은 드물어서 요청 한 번 더 드는 것은 문제가 아니다.
 *
 * 필요한 환경 변수: `GOOGLE_WEB_CLIENT_ID` (Google Cloud의 "웹 애플리케이션"
 * OAuth 클라이언트 ID). 쉼표로 여러 개 가능. 없으면 Google 로그인은 꺼진다.
 */

export type GoogleIdentity = {
  sub: string;
  email: string | null;
  name: string | null;
};

export function googleClientIds(): string[] {
  return (process.env.GOOGLE_WEB_CLIENT_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

type TokenInfo = {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  exp?: unknown;
};

/** tokeninfo 답을 읽는다. 순수 함수라 테스트한다. */
export function readTokenInfo(
  info: TokenInfo,
  clientIds: string[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
): GoogleIdentity | null {
  if (typeof info.aud !== "string" || !clientIds.includes(info.aud)) return null;
  if (typeof info.iss !== "string" || !ISSUERS.has(info.iss)) return null;
  if (typeof info.sub !== "string" || !/^\d{5,64}$/.test(info.sub)) return null;
  const exp = Number(info.exp);
  if (!Number.isFinite(exp) || exp < nowSeconds) return null;
  const verified = info.email_verified === true || info.email_verified === "true";
  const email = verified && typeof info.email === "string" ? info.email.trim().toLowerCase() : null;
  const name = typeof info.name === "string" ? info.name : null;
  return { sub: info.sub, email, name };
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  const clientIds = googleClientIds();
  if (clientIds.length === 0 || !idToken || idToken.length > 4096) return null;
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    return readTokenInfo((await response.json()) as TokenInfo, clientIds);
  } catch (error) {
    console.error("[account] google tokeninfo failed", error);
    return null;
  }
}
