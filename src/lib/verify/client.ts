import { postAction } from "@/lib/api";

/**
 * 성인 본인인증(포트원 V2) — 원본 `lib/random/client.ts`의 인증 창 부분을 그대로 옮기고
 * 돌아올 화면만 이 앱(`?screen=verify`)으로 바꿨다.
 */

export type VerifyStatus = {
  state: "verified" | "minor" | "blocked" | "unverified";
  /** 서버에 포트원 키가 있는지. */
  ready: boolean;
  /** 서버가 인증을 요구하는지(ADULT_VERIFY_REQUIRED). */
  required: boolean;
};

export function fetchVerifyStatus(): Promise<VerifyStatus> {
  return postAction<VerifyStatus>("/api/verify", { action: "status" });
}

export function submitVerification(verificationId: string): Promise<VerifyStatus> {
  return postAction<VerifyStatus>("/api/verify", { action: "verify", verificationId });
}

type PortOneResponse = { code?: string; message?: string; identityVerificationId?: string } | undefined;
type PortOneSdk = {
  requestIdentityVerification: (request: {
    storeId: string;
    identityVerificationId: string;
    channelKey: string;
    customData?: string;
    redirectUrl?: string;
  }) => Promise<PortOneResponse>;
};

const SDK_URL = "https://cdn.portone.io/v2/browser-sdk.js";

/** 앱 쪽 설정(공개 값). 둘 다 있어야 인증 창을 연다. */
export function portoneClientReady(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PORTONE_STORE_ID && process.env.NEXT_PUBLIC_PORTONE_IDV_CHANNEL_KEY);
}

function loadSdk(): Promise<PortOneSdk> {
  const ready = (window as unknown as { PortOne?: PortOneSdk }).PortOne;
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      const sdk = (window as unknown as { PortOne?: PortOneSdk }).PortOne;
      if (sdk) resolve(sdk);
      else reject(new Error("PortOne SDK missing"));
    };
    script.onerror = () => reject(new Error("PortOne SDK failed"));
    document.head.appendChild(script);
  });
}

/**
 * 본인인증 창을 연다. 모바일 웹은 인증 뒤 이 화면으로 되돌아오며(`redirectUrl`) 주소에
 * `identityVerificationId`가 붙는다 — 앱 첫 화면이 그걸 보고 마저 확인한다(takeReturnedVerification).
 * 데스크톱은 같은 화면에서 끝나 인증 번호를 돌려준다. 취소·실패면 null.
 */
export async function openAdultVerification(accountId: string): Promise<string | null> {
  const sdk = await loadSdk();
  const identityVerificationId = `dav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const back = new URL(window.location.href);
  back.searchParams.set("screen", "verify");
  const result = await sdk.requestIdentityVerification({
    storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID ?? "",
    identityVerificationId,
    channelKey: process.env.NEXT_PUBLIC_PORTONE_IDV_CHANNEL_KEY ?? "",
    // 서버가 "인증 창을 연 계정"과 맞춰 본다(api/verify).
    customData: accountId,
    redirectUrl: back.toString(),
  });
  if (!result || result.code) return null;
  return result.identityVerificationId ?? identityVerificationId;
}

/** 모바일에서 인증 뒤 돌아왔을 때 주소의 인증 번호(있으면 한 번 꺼내고 주소에서 지운다). */
export function takeReturnedVerification(): string | null {
  try {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("identityVerificationId");
    const failed = url.searchParams.get("code");
    if (!id) return null;
    for (const key of ["identityVerificationId", "identityVerificationTxId", "transactionType", "code", "message", "screen"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.toString());
    return failed ? null : id;
  } catch {
    return null;
  }
}
