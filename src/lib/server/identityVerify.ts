/**
 * 포트원 V2 본인인증 결과 조회(랜덤 연결의 성인 확인, lib/random/protocol.ts).
 *
 * 앱은 포트원 창에서 인증을 마치면 인증 번호만 서버로 보낸다. 서버가 그 번호로 포트원에 직접 물어
 * 생년월일·ci를 받는다 — 앱이 보낸 나이를 믿지 않는다. 키(`PORTONE_API_SECRET`)는 서버에만.
 * 응답 모양: `GET https://api.portone.io/identity-verifications/{id}?storeId=` →
 * `{ status: "VERIFIED", verifiedCustomer: { birthDate: "yyyy-MM-dd", ci, isForeigner, … }, customData }`.
 */

export type PortoneVerification =
  | { ok: true; birthDate: string; ci: string | null; foreigner: boolean; customData: string | null }
  | { ok: false; reason: "NOT_CONFIGURED" | "NOT_FOUND" | "NOT_VERIFIED" | "NO_BIRTHDATE" | "ERROR" };

export function portoneConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.PORTONE_API_SECRET?.trim() && env.NEXT_PUBLIC_PORTONE_STORE_ID?.trim());
}

/** 포트원 응답 한 건을 우리가 쓰는 모양으로(테스트가 이것만 본다). */
export function readPortoneVerification(body: unknown): PortoneVerification {
  if (!body || typeof body !== "object") return { ok: false, reason: "ERROR" };
  const row = body as { status?: unknown; verifiedCustomer?: Record<string, unknown>; customData?: unknown };
  if (row.status !== "VERIFIED") return { ok: false, reason: "NOT_VERIFIED" };
  const customer = row.verifiedCustomer ?? {};
  const birthDate = typeof customer.birthDate === "string" ? customer.birthDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return { ok: false, reason: "NO_BIRTHDATE" };
  return {
    ok: true,
    birthDate,
    ci: typeof customer.ci === "string" && customer.ci ? customer.ci : null,
    foreigner: customer.isForeigner === true,
    customData: typeof row.customData === "string" ? row.customData : null,
  };
}

export async function fetchPortoneVerification(
  verificationId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<PortoneVerification> {
  if (!portoneConfigured(env)) return { ok: false, reason: "NOT_CONFIGURED" };
  try {
    const url = new URL(`/identity-verifications/${encodeURIComponent(verificationId)}`, "https://api.portone.io");
    url.searchParams.set("storeId", env.NEXT_PUBLIC_PORTONE_STORE_ID!.trim());
    const response = await fetcher(url, {
      headers: { Authorization: `PortOne ${env.PORTONE_API_SECRET!.trim()}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404) return { ok: false, reason: "NOT_FOUND" };
    if (!response.ok) return { ok: false, reason: "ERROR" };
    return readPortoneVerification(await response.json());
  } catch {
    return { ok: false, reason: "ERROR" };
  }
}
