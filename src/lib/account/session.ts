import type { PublicAccount } from "./shared.ts";

/**
 * 이 기기의 로그인 상태: 토큰과 마지막으로 받은 계정. localStorage에 둔다.
 *
 * billingService가 모든 API 요청 헤더에 토큰을 싣기 위해 읽으므로, 다른 앱
 * 모듈을 가져오지 않는다(순환 방지).
 */

const TOKEN_KEY = "ec_auth_token";
const ACCOUNT_KEY = "ec_account";

type Listener = () => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readAuthToken(): string | null {
  try {
    return storage()?.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

let cachedAccount: PublicAccount | null | undefined;

export function readCachedAccount(): PublicAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  try {
    const raw = storage()?.getItem(ACCOUNT_KEY);
    cachedAccount = raw ? (JSON.parse(raw) as PublicAccount) : null;
  } catch {
    cachedAccount = null;
  }
  return cachedAccount;
}

function emit() {
  for (const listener of listeners) listener();
}

export function saveSession(token: string, account: PublicAccount): void {
  try {
    storage()?.setItem(TOKEN_KEY, token);
  } catch {
    // 저장이 안 되면 이번 실행 동안만 로그인 — 헤더는 아래 캐시로 못 읽으니 사실상 로그아웃.
  }
  saveAccount(account);
}

export function saveAccount(account: PublicAccount): void {
  cachedAccount = account;
  try {
    storage()?.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // 사진이 커서 못 넣으면 사진 없이라도.
    try {
      storage()?.setItem(ACCOUNT_KEY, JSON.stringify({ ...account, profile: { ...account.profile, photo: null } }));
    } catch {
      /* 무시 */
    }
  }
  emit();
}

export function clearSession(): void {
  cachedAccount = null;
  try {
    storage()?.removeItem(TOKEN_KEY);
    storage()?.removeItem(ACCOUNT_KEY);
  } catch {
    /* 무시 */
  }
  emit();
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
