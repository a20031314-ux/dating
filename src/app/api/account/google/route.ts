import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { authDisabled, loginResponse, readJsonBody } from "@/lib/server/accountRequest";
import { findOrCreateAccount } from "@/lib/server/accountStore";
import { requestUserId } from "@/lib/server/request";
import { googleClientIds, verifyGoogleIdToken } from "@/lib/server/googleIdToken";

export const dynamic = "force-dynamic";

/**
 * Google 로그인: 앱이 받은 ID 토큰을 확인하고 로그인한다.
 *
 * POST { idToken } → { token, account, created } | { error: GOOGLE_DISABLED | GOOGLE_INVALID }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const disabled = authDisabled(request);
  if (disabled) return disabled;
  if (googleClientIds().length === 0) {
    return jsonWithCors(request, { error: "GOOGLE_DISABLED" }, { status: 503 });
  }
  const body = await readJsonBody<{ idToken?: unknown }>(request, 8_000);
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  const google = await verifyGoogleIdToken(idToken);
  if (!google) return jsonWithCors(request, { error: "GOOGLE_INVALID" }, { status: 401 });

  const { account, created } = await findOrCreateAccount(
    { kind: "google", sub: google.sub, email: google.email, name: google.name },
    requestUserId(request),
  );
  return loginResponse(request, account, created);
}
