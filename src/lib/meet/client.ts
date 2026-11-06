import { postAction } from "@/lib/api";
import { apiUrl } from "@/lib/apiBase";
import type { DatingCard, Gender, Region } from "@/lib/dating/rules";
import type { GroupMessage } from "@/lib/rooms/group";
import type { MeetCost, MeetSeats, MeetView } from "./rules";

/** 앱 → /api/meet. 서버 동작은 app/api/meet/route.ts 머리 주석. */

export type MeetDetail = { meet: MeetView; members: DatingCard[]; applicants?: { card: DatingCard; gender: Gender }[] };

export const meetApi = {
  list: (region: Region) => postAction<{ meets: MeetView[]; appliesLeft: number }>("/api/meet", { action: "list", region }),
  mine: () => postAction<{ meets: MeetView[] }>("/api/meet", { action: "mine" }),
  get: (id: string) => postAction<MeetDetail>("/api/meet", { action: "get", id }),
  create: (input: { region: Region; area: string; place: string; at: number; seats: MeetSeats; cost: MeetCost; note: string }) =>
    postAction<{ meet: MeetView }>("/api/meet", { action: "create", ...input }),
  act: (action: "apply" | "cancel" | "leave" | "close", id: string) => postAction<unknown>("/api/meet", { action, id }),
  decide: (action: "approve" | "reject" | "kick", id: string, target: string) => postAction<unknown>("/api/meet", { action, id, target }),
  chat: (id: string, since: number) => postAction<{ messages: GroupMessage[]; gone: number[] }>("/api/meet", { action: "chat", id, since }),
  send: (id: string, text: string) => postAction<{ message: GroupMessage }>("/api/meet", { action: "send", id, text }),
};

export function hostPhotoUrl(path: string | null): string | null {
  return path ? apiUrl(path) : null;
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** "오늘 23:00", "내일 21:30", "11/9(일) 20:00" */
export function whenLabel(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(new Date(now))) / 86_400_000);
  if (days === 0) return `오늘 ${time}`;
  if (days === 1) return `내일 ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY[date.getDay()]}) ${time}`;
}

/** "남 1/2 · 여 2/2" 또는 "3/4명" */
export function seatsLabel(seats: MeetSeats, filled: { m: number; f: number }): string {
  if (seats.kind === "any") return `${filled.m + filled.f}/${seats.total}명`;
  return `남 ${filled.m}/${seats.m} · 여 ${filled.f}/${seats.f}`;
}
