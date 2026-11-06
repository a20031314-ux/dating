import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { authConfigured } from "@/lib/server/authToken";
import { googleClientIds } from "@/lib/server/googleIdToken";
import { emailConfigured } from "@/lib/server/emailSender";
import type { AuthConfig } from "@/lib/account/shared";

export const dynamic = "force-dynamic";

/**
 * 어떤 로그인을 보여 줄지. 앱은 설정된 것만 버튼으로 띄운다 — 환경 변수를
 * 넣으면 앱을 다시 빌드하지 않아도 버튼이 생긴다.
 *
 * GET → { googleClientId: string | null, email: boolean, password: boolean }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const on = authConfigured();
  const body: AuthConfig = {
    googleClientId: on ? (googleClientIds()[0] ?? null) : null,
    email: on && emailConfigured(),
    password: on,
  };
  return jsonWithCors(request, body);
}
