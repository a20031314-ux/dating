import type { NextRequest } from "next/server";
import { jsonWithCors } from "./cors";
import { requestAuth } from "./request";
import { readAccount, toPublic, type AccountRecord } from "./accountStore";
import { authConfigured, issueAuthToken } from "./authToken";
import type { LoginResult } from "@/lib/account/shared";

/** 토큰의 계정을 읽는다. 없거나 지워졌으면 401 응답을 같이 돌려준다. */
export async function accountFromRequest(
  request: NextRequest,
): Promise<{ account: AccountRecord } | { response: ReturnType<typeof jsonWithCors> }> {
  const auth = requestAuth(request);
  if (!auth) return { response: jsonWithCors(request, { error: "SIGNED_OUT" }, { status: 401 }) };
  const account = await readAccount(auth.accountId);
  if (!account) return { response: jsonWithCors(request, { error: "ACCOUNT_GONE" }, { status: 401 }) };
  return { account };
}

export async function loginResponse(
  request: NextRequest,
  account: AccountRecord,
  created: boolean,
) {
  const token = issueAuthToken({ accountId: account.id, dataUserId: account.dataUserId });
  if (!token) return jsonWithCors(request, { error: "AUTH_DISABLED" }, { status: 503 });
  const body: LoginResult = { token, account: await toPublic(account), created };
  return jsonWithCors(request, body);
}

export function authDisabled(request: NextRequest) {
  return authConfigured() ? null : jsonWithCors(request, { error: "AUTH_DISABLED" }, { status: 503 });
}

/** 본문 JSON을 읽되, 깨졌거나 너무 크면 null. */
export async function readJsonBody<T>(request: NextRequest, maxBytes = 200_000): Promise<T | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
