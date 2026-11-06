import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { requestAuth } from "@/lib/server/request";
import { fetchPortoneVerification, portoneConfigured } from "@/lib/server/identityVerify";
import { isOff, readAdult, recordAdult } from "@/lib/server/randomStore";
import { adultVerifyRequired } from "@/lib/server/datingCards";

export const dynamic = "force-dynamic";

/**
 * 성인 본인인증 — 원본 랜덤 연결(`api/random` verify)의 인증 부분만 떼어 온 것.
 * 포트원 V2 본인인증 번호를 받아 서버가 포트원에 직접 생년월일·ci를 묻는다(앱이 보낸 나이는 믿지 않음).
 * 같은 사람(ci 해시)은 한 계정만 — 여러 계정으로 다시 가입하는 것을 막는다(server/randomStore.ts).
 *
 *   status                    → { state: "verified" | "minor" | "blocked" | "unverified", ready, required }
 *   verify { verificationId } → 같은 모양
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

const bad = (request: NextRequest, error: string, status = 400) => jsonWithCors(request, { error }, { status });

async function statusFor(me: string) {
  const record = await readAdult(me);
  const base = { ready: portoneConfigured(), required: adultVerifyRequired() };
  if (!record) return { state: "unverified" as const, ...base };
  if (record.offBy || (await isOff(record))) return { state: "blocked" as const, ...base };
  return { state: record.adult ? ("verified" as const) : ("minor" as const), ...base };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad(request, "Invalid JSON");
  }
  const auth = requestAuth(request);
  if (!auth) return bad(request, "SIGNED_OUT", 401);
  const me = auth.accountId;

  if (body.action === "status") return jsonWithCors(request, await statusFor(me));

  if (body.action === "verify") {
    const verificationId = typeof body.verificationId === "string" ? body.verificationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(verificationId)) return bad(request, "BAD_ID");
    const found = await fetchPortoneVerification(verificationId);
    if (!found.ok) return bad(request, found.reason, found.reason === "NOT_CONFIGURED" ? 503 : 400);
    // 인증 창을 연 계정과 같아야 한다(앱이 customData에 계정 id를 넣어 연다).
    if (found.customData !== me) return bad(request, "NOT_MINE", 403);
    const result = await recordAdult(me, verificationId, { birthDate: found.birthDate, ci: found.ci, foreigner: found.foreigner });
    if (result === "USED" || result === "CI_TAKEN" || result === "OFF") return bad(request, result, 409);
    return jsonWithCors(request, await statusFor(me));
  }

  return bad(request, "UNKNOWN_ACTION");
}
