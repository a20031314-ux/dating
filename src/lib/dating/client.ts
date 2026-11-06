import { postAction } from "@/lib/api";
import { apiUrl } from "@/lib/apiBase";
import { photoPath } from "./photoPath";
import { PHOTO_MAX_CHARS, type DatingCard, type DatingProfile, type DatingWant, type Gender, type MatchRow, type Region } from "./rules";
import type { DmMessage, DmSummary, DmThread } from "@/lib/rooms/dm";

/** 앱 → /api/dating, /api/dm, /api/social 호출. 서버 동작 설명은 각 route.ts 머리 주석. */

export type DatingMe = { profile: DatingProfile | null; likesLeft: number; verified: boolean; verifyRequired: boolean };

export const datingApi = {
  me: () => postAction<DatingMe>("/api/dating", { action: "me" }),
  save: (input: { gender: Gender; birthYear: number; region: Region; want: DatingWant; visible: boolean }) =>
    postAction<{ profile: DatingProfile }>("/api/dating", { action: "save", ...input }),
  photoAdd: (image: string) => postAction<{ profile: DatingProfile }>("/api/dating", { action: "photoAdd", image }),
  photoRemove: (version: string) => postAction<{ profile: DatingProfile }>("/api/dating", { action: "photoRemove", version }),
  photoOrder: (order: string[]) => postAction<{ profile: DatingProfile }>("/api/dating", { action: "photoOrder", order }),
  discover: () => postAction<{ cards: DatingCard[] }>("/api/dating", { action: "discover" }),
  like: (target: string) => postAction<{ matched: boolean; threadId?: string }>("/api/dating", { action: "like", target }),
  pass: (target: string) => postAction<{ ok: true }>("/api/dating", { action: "pass", target }),
  likedMe: () => postAction<{ cards: DatingCard[] }>("/api/dating", { action: "likedMe" }),
  matches: () => postAction<{ matches: MatchRow[] }>("/api/dating", { action: "matches" }),
  unmatch: (target: string) => postAction<{ ok: true }>("/api/dating", { action: "unmatch", target }),
};

export type DmOpen = { thread: DmThread | null; messages: DmMessage[]; blocked: boolean; gone: number[]; peerRead: number; matched: boolean };
export type DmPoll = { thread: DmThread; messages: DmMessage[]; gone: number[]; peerRead: number };

export const dmApi = {
  inbox: () => postAction<{ threads: DmSummary[] }>("/api/dm", { action: "inbox" }),
  open: (target: string) => postAction<DmOpen>("/api/dm", { action: "open", target }),
  poll: (threadId: string, since: number) => postAction<DmPoll>("/api/dm", { action: "poll", threadId, since }),
  send: (target: string, text: string) => postAction<{ thread: DmThread; message: DmMessage }>("/api/dm", { action: "send", target, text }),
  unsend: (threadId: string, seq: number) => postAction<{ ok: true }>("/api/dm", { action: "unsend", threadId, seq }),
};

export const socialApi = {
  blocked: () => postAction<{ cards: DatingCard[] }>("/api/social", { action: "blocked" }),
  block: (target: string) => postAction<{ ok: true }>("/api/social", { action: "block", target }),
  unblock: (target: string) => postAction<{ ok: true }>("/api/social", { action: "unblock", target }),
  report: (target: string, reason: string, lines: string[] = []) =>
    postAction<{ ok: true }>("/api/social", { action: "report", target, reason, lines }),
};

export function photoUrl(accountId: string, version: string): string {
  return apiUrl(photoPath(accountId, version));
}

/**
 * 고른 사진을 서버 한도(PHOTO_MAX_CHARS) 안의 JPEG data URL로 줄인다 — 긴 변 1080px부터,
 * 넘으면 화질과 크기를 차례로 낮춘다.
 */
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const side of [1080, 900, 720, 560]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.58]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= PHOTO_MAX_CHARS) return dataUrl;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("PHOTO_TOO_BIG");
}
