import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { requestAuth } from "@/lib/server/request";
import { readAccounts } from "@/lib/server/accountStore";
import { blockedEitherWay, isAccountId } from "@/lib/server/socialStore";
import { suspendedResponse } from "@/lib/server/suspension";
import { readDatingProfile, readDatingProfiles } from "@/lib/server/datingStore";
import { adultVerifyRequired, cardsFor, isVerifiedAdult } from "@/lib/server/datingCards";
import { pollFrom } from "@/lib/server/lateRows";
import { markGroupRead, readGroupGone, readGroupMessages, sendToGroup } from "@/lib/server/groupStore";
import {
  appliesLeft,
  apply,
  cancelApply,
  closeMeet,
  createMeet,
  decide,
  filledOf,
  leaveMeet,
  listMeets,
  myMeetIds,
  readApplications,
  readMeet,
  removeMember,
} from "@/lib/server/meetStore";
import { cleanMeetInput, isOpen, type MeetView, type Meetup } from "@/lib/meet/rules";
import { isRegion, yearAge } from "@/lib/dating/rules";
import { photoPath } from "@/lib/dating/photoPath";
import { cleanText } from "@/lib/text";

export const dynamic = "force-dynamic";

/**
 * 지역 모임(새로 만든 부분). 모두 로그인 + 데이팅 프로필(성별로 자리를 센다)이 있어야 한다.
 *
 *   list { region }            → { meets: MeetView[], appliesLeft }   그 지역, 가까운 시각 순
 *   mine                       → { meets: MeetView[] }                내가 열었거나 신청한 것
 *   get { id }                 → { meet, members, applicants? }       applicants는 방장만
 *   create { region, area, place, at, seats, cost, note } → { meet }
 *   apply / cancel / leave { id }
 *   approve / reject / kick { id, target }   (방장)
 *   close { id }                             (방장)
 *   chat { id, since }         → { messages, gone }   (들어온 사람만, 읽음 표시)
 *   send { id, text }          → { message }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

const bad = (request: NextRequest, error: string, status = 400) => jsonWithCors(request, { error }, { status });

const WRITES = ["create", "apply", "approve", "send"];
const NEEDS_ADULT = ["list", "get", "create", "apply"];

/** 모집글 → 화면 모양. 정확한 장소는 들어온 사람에게만. */
async function viewOf(meet: Meetup, me: string): Promise<MeetView> {
  const [filled, apps, [host], [hostProfile]] = await Promise.all([
    filledOf(meet),
    readApplications(meet.id),
    readAccounts([meet.host]),
    readDatingProfiles([meet.host]),
  ]);
  const member = filled.members.includes(me);
  const app = apps.find((row) => row.account === me);
  const relation: MeetView["me"] = meet.host === me ? "host" : member ? "member" : app?.state === "pending" ? "pending" : app?.state === "rejected" ? "rejected" : "none";
  return {
    id: meet.id,
    region: meet.region,
    area: meet.area,
    place: member ? meet.place : null,
    at: meet.at,
    seats: meet.seats,
    filled: { m: filled.m, f: filled.f },
    cost: meet.cost,
    note: meet.note,
    host: {
      id: meet.host,
      nickname: host?.profile.nickname || host?.username || "",
      age: hostProfile ? yearAge(hostProfile.birthYear) : 0,
      photo: hostProfile?.photos[0] ? photoPath(meet.host, hostProfile.photos[0]) : null,
    },
    me: relation,
    open: isOpen(meet, filled),
    groupId: member ? meet.groupId : null,
  };
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
  const action = typeof body.action === "string" ? body.action : "";

  if (WRITES.includes(action)) {
    const stop = await suspendedResponse(request, me);
    if (stop) return stop;
  }
  if (adultVerifyRequired() && NEEDS_ADULT.includes(action) && !(await isVerifiedAdult(me))) return bad(request, "UNVERIFIED", 403);
  const profile = await readDatingProfile(me);
  if (!profile) return bad(request, "NO_PROFILE", 409);

  if (action === "list") {
    if (!isRegion(body.region)) return bad(request, "BAD_REGION");
    const meets: MeetView[] = [];
    for (const meet of await listMeets(body.region)) {
      if (meet.host !== me && (await blockedEitherWay(me, meet.host))) continue;
      meets.push(await viewOf(meet, me));
    }
    return jsonWithCors(request, { meets, appliesLeft: await appliesLeft(me) });
  }

  if (action === "mine") {
    const meets: MeetView[] = [];
    for (const id of await myMeetIds(me)) {
      const meet = await readMeet(id);
      if (meet) meets.push(await viewOf(meet, me));
    }
    return jsonWithCors(request, { meets });
  }

  if (action === "create") {
    const input = cleanMeetInput(body, profile.gender);
    if ("error" in input) return bad(request, input.error);
    const result = await createMeet(me, input.ok);
    if ("error" in result) return bad(request, result.error, 409);
    return jsonWithCors(request, { meet: await viewOf(result.ok, me) });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const meet = await readMeet(id);
  if (!meet) return bad(request, "NO_MEET", 404);
  if (meet.host !== me && (await blockedEitherWay(me, meet.host))) return bad(request, "BLOCKED", 403);

  if (action === "get") {
    const view = await viewOf(meet, me);
    const { members } = await filledOf(meet);
    const memberCards = view.groupId ? await cardsFor(members) : [];
    let applicants;
    if (meet.host === me) {
      const pending = (await readApplications(meet.id)).filter((row) => row.state === "pending");
      const cards = await cardsFor(pending.map((row) => row.account));
      applicants = cards.map((card) => ({ card, gender: pending.find((row) => row.account === card.id)!.gender }));
    }
    return jsonWithCors(request, { meet: view, members: memberCards, ...(applicants ? { applicants } : {}) });
  }

  if (action === "apply") {
    const result = await apply(me, profile.gender, meet.id);
    return "error" in result ? bad(request, result.error, 409) : jsonWithCors(request, { meet: await viewOf(meet, me) });
  }
  if (action === "cancel") {
    return (await cancelApply(me, meet.id)) ? jsonWithCors(request, { ok: true }) : bad(request, "NO_APPLICATION", 409);
  }
  if (action === "leave") {
    return (await leaveMeet(me, meet.id)) ? jsonWithCors(request, { ok: true }) : bad(request, "NOT_MEMBER", 409);
  }
  if (action === "close") {
    return (await closeMeet(me, meet.id)) ? jsonWithCors(request, { ok: true }) : bad(request, "NOT_HOST", 403);
  }
  if (action === "approve" || action === "reject" || action === "kick") {
    if (!isAccountId(body.target)) return bad(request, "BAD_TARGET");
    if (action === "kick") {
      return (await removeMember(me, meet.id, body.target)) ? jsonWithCors(request, { ok: true }) : bad(request, "NOT_HOST", 403);
    }
    if (action === "approve" && (await blockedEitherWay(me, body.target))) return bad(request, "BLOCKED", 403);
    const result = await decide(me, meet.id, body.target, action === "approve");
    return "error" in result ? bad(request, result.error, 409) : jsonWithCors(request, { ok: true });
  }

  // 단체방 채팅 — 원본 groupStore가 들어온 사람인지 본다.
  if (action === "chat") {
    const { members } = await filledOf(meet);
    if (!members.includes(me)) return bad(request, "NOT_MEMBER", 403);
    const since = typeof body.since === "number" && Number.isFinite(body.since) ? body.since : 0;
    const [messages, gone] = await Promise.all([readGroupMessages(meet.groupId, pollFrom(since)), readGroupGone(meet.groupId)]);
    const last = messages.at(-1)?.seq;
    if (last) await markGroupRead(me, meet.groupId, last);
    return jsonWithCors(request, { messages, gone });
  }
  if (action === "send") {
    const text = cleanText(body.text, 1000);
    if (!text) return bad(request, "NO_TEXT");
    const result = await sendToGroup({ from: me, id: meet.groupId, text });
    return result.ok ? jsonWithCors(request, { message: result.message }) : bad(request, result.error, 403);
  }

  return bad(request, "UNKNOWN_ACTION");
}
