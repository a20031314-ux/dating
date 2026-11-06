import type { NextRequest } from "next/server";
import { SHARED_ANONYMOUS_ID } from "./identity.ts";
import { verifyAuthToken, type AuthClaims } from "./authToken.ts";
import { AUTH_TOKEN_HEADER } from "@/lib/account/shared";

/**
 * 누가 묻는지 — 원본(english-chat-mvp `server/premiumRequest.ts`)에서 결제·구독 판단을 뺀 것.
 *
 * 데이팅앱은 아직 유료 기능이 없어서 RevenueCat·요금제·초대 보상을 읽지 않는다.
 * 구독을 붙일 때는 원본의 `resolveRequestEntitlement`를 다시 가져오면 된다.
 */

/** 로그인 토큰(헤더 `x-auth-token`)이 맞으면 그 계정, 아니면 null. */
export function requestAuth(request: NextRequest): AuthClaims | null {
  return verifyAuthToken(request.headers.get(AUTH_TOKEN_HEADER)?.trim());
}

/** 로그인 전 기기를 구분하는 쿠키 — 설치가 바뀌면 함께 바뀐다. */
function cookieUserId(request: NextRequest): string {
  return request.cookies.get("ec_uid")?.value ?? SHARED_ANONYMOUS_ID;
}

/**
 * 기록을 묶을 사용자 id. 로그인했으면 계정의 `dataUserId`,
 * 아니면 이 기기의 쿠키 id(첫 가입 때 계정 기록이 된다, accountStore.findOrCreateAccount).
 */
export function requestUserId(request: NextRequest): string {
  const auth = requestAuth(request);
  if (auth) return auth.dataUserId;
  return cookieUserId(request);
}
