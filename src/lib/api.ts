import { apiUrl } from "@/lib/apiBase";
import { readAuthToken } from "@/lib/account/session";
import { AUTH_TOKEN_HEADER } from "@/lib/account/shared";

/**
 * 앱 → 서버 요청 공통. 로그인 토큰을 헤더에 싣는다(원본은 billingService.entitlementHeaders가 하던 일).
 */
export function authHeaders(): Record<string, string> {
  const token = readAuthToken();
  return token ? { [AUTH_TOKEN_HEADER]: token } : {};
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** POST {action, ...} 모양의 API를 부른다. 실패하면 ApiError(서버의 error 코드). */
export async function postAction<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK", 0);
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? "UNKNOWN", response.status, data as Record<string, unknown>);
  return data;
}
