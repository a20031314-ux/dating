import type { ProfileFacts, ProfileShow } from "./profileFacts";
import { Capacitor } from "@capacitor/core";
import { apiUrl } from "@/lib/apiBase";
import { authHeaders } from "@/lib/api";
import { clearSession, readAuthToken, saveAccount, saveSession } from "./session";
import type { AuthConfig, LoginResult, PublicAccount } from "./shared";

/**
 * 앱 쪽 로그인·프로필 요청. 화면은 components/account/.
 *
 * 원본(english-chat-mvp `lib/account/client.ts`)에서 결제(RevenueCat) 연결만 뺐다.
 * 로그인에 성공하면: 토큰 저장 → 앱을 다시 연다(모든 화면이 계정 기록으로 다시 그림).
 */

export type AccountError =
  | "INVALID_EMAIL"
  | "RATE_LIMITED"
  | "SEND_FAILED"
  | "WRONG_CODE"
  | "CODE_EXPIRED"
  | "TOO_MANY_TRIES"
  | "GOOGLE_CANCELLED"
  | "GOOGLE_FAILED"
  | "PHOTO_INVALID"
  | "USERNAME_INVALID"
  | "USERNAME_TAKEN"
  | "PASSWORD_WEAK"
  | "WRONG_PASSWORD"
  | "SIGNED_OUT"
  | "NETWORK";

export class AccountRequestError extends Error {
  /** detail: 화면 아래 작게 보여 줄 원인(Google 로그인 실패를 기기에서 가려내려고). */
  constructor(readonly code: AccountError, readonly detail = "") {
    super(code);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AccountRequestError("NETWORK");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const code = data.error;
    if (code === "ACCOUNT_GONE" || code === "SIGNED_OUT") throw new AccountRequestError("SIGNED_OUT");
    if (code === "GOOGLE_INVALID" || code === "GOOGLE_DISABLED") throw new AccountRequestError("GOOGLE_FAILED", `server ${code}`);
    const known: AccountError[] = [
      "INVALID_EMAIL", "RATE_LIMITED", "SEND_FAILED", "WRONG_CODE", "CODE_EXPIRED", "TOO_MANY_TRIES", "PHOTO_INVALID",
      "USERNAME_INVALID", "USERNAME_TAKEN", "PASSWORD_WEAK", "WRONG_PASSWORD",
    ];
    throw new AccountRequestError(known.includes(code as AccountError) ? (code as AccountError) : "NETWORK");
  }
  return data;
}

let configPromise: Promise<AuthConfig> | null = null;

/**
 * 서버가 켜 둔 로그인 방식. Google은 안드로이드 앱에서만 띄운다 — iOS는 Google을
 * 띄우면 Apple 로그인도 요구되므로 1차엔 아이디·비밀번호·이메일만(`lib/platform.ts`).
 */
export function fetchAuthConfig(): Promise<AuthConfig> {
  configPromise ??= call<AuthConfig>("/api/account/config")
    .then((config) => ({
      googleClientId: config.googleClientId,
      email: config.email,
      password: config.password === true,
    }))
    .catch(() => {
      configPromise = null;
      return { googleClientId: null, email: false, password: false };
    });
  return configPromise;
}

async function finishLogin(result: LoginResult): Promise<void> {
  saveSession(result.token, result.account);
  if (typeof window !== "undefined") window.location.reload();
}

export async function startEmailLogin(email: string, locale: string): Promise<void> {
  await call("/api/account/email/start", { body: { email, locale } });
}

export async function verifyEmailLogin(email: string, code: string): Promise<void> {
  await finishLogin(await call<LoginResult>("/api/account/email/verify", { body: { email, code } }));
}

export async function passwordSignup(username: string, password: string): Promise<void> {
  await finishLogin(await call<LoginResult>("/api/account/password/signup", { body: { username, password } }));
}

export async function passwordLogin(username: string, password: string): Promise<void> {
  await finishLogin(await call<LoginResult>("/api/account/password/login", { body: { username, password } }));
}

export async function changePassword(current: string, next: string): Promise<void> {
  await call("/api/account/password/change", { body: { current, next } });
}

let googleReady: Promise<void> | null = null;

export async function googleLogin(clientId: string): Promise<void> {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  googleReady ??= SocialLogin.initialize({ google: { webClientId: clientId } }).catch((error) => {
    googleReady = null;
    throw error;
  });
  let idToken: string | null = null;
  try {
    await googleReady;
    // scopes를 넘기지 않는다: 플러그인은 email·profile·openid를 늘 요청하고, scopes를 주면
    // MainActivity를 바꾸지 않은 앱에선 "You CANNOT use scopes…"로 바로 거절한다(2.68·2.69에서 Google 로그인이 늘 실패한 원인).
    const response = await SocialLogin.login({ provider: "google", options: {} });
    const result = response.result as { idToken?: string | null };
    idToken = result.idToken ?? null;
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error).toLowerCase();
    if (message.includes("cancel")) throw new AccountRequestError("GOOGLE_CANCELLED");
    console.warn("[account] google login failed", error);
    throw new AccountRequestError("GOOGLE_FAILED", String((error as { message?: string })?.message ?? error).slice(0, 140));
  }
  if (!idToken) throw new AccountRequestError("GOOGLE_FAILED", "no idToken");
  await finishLogin(await call<LoginResult>("/api/account/google", { body: { idToken } }));
}

/** 앱을 열 때 계정을 새로 받는다. 계정이 지워졌으면 로그아웃 상태로. */
export async function refreshAccount(): Promise<PublicAccount | null> {
  if (!readAuthToken()) return null;
  try {
    const { account } = await call<{ account: PublicAccount }>("/api/account/me");
    saveAccount(account);
    return account;
  } catch (error) {
    if (error instanceof AccountRequestError && error.code === "SIGNED_OUT") {
      clearSession();
    }
    return null;
  }
}

export async function saveProfile(next: {
  nickname: string;
  bio: string;
  photo?: string | null;
  hidden?: boolean;
  readReceipts?: boolean;
  /** 나에 대한 사실·프로필에 보일 칸(account/profileFacts.ts). 안 보내면 서버 값 그대로. */
  facts?: ProfileFacts;
  show?: Partial<ProfileShow>;
}): Promise<PublicAccount> {
  const { account } = await call<{ account: PublicAccount }>("/api/account/profile", { body: next });
  saveAccount(account);
  return account;
}

async function signOutHere(): Promise<void> {
  clearSession();
  if (Capacitor.isNativePlatform()) {
    try {
      const { SocialLogin } = await import("@capgo/capacitor-social-login");
      if (googleReady) await SocialLogin.logout({ provider: "google" });
    } catch {
      // Google 쪽 로그아웃이 안 돼도 앱 로그아웃은 끝났다.
    }
  }
  if (typeof window !== "undefined") window.location.reload();
}

export async function logout(): Promise<void> {
  await signOutHere();
}

export async function deleteAccount(): Promise<void> {
  await call("/api/account/delete", { body: {} });
  await signOutHere();
}
