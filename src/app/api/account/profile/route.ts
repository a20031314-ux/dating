import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { accountFromRequest, readJsonBody } from "@/lib/server/accountRequest";
import { saveProfile, toPublic } from "@/lib/server/accountStore";
import { cleanBio, cleanNickname, cleanPhoto } from "@/lib/account/shared";
import { cleanShow, mergeFacts } from "@/lib/account/profileFacts";

export const dynamic = "force-dynamic";

/**
 * 프로필 저장: 닉네임·자기소개·사진.
 *
 * POST { nickname, bio, photo?, hidden?, facts?, show? } — photo가 없으면 그대로, null이면 지움, data URL이면 바꿈.
 * facts(나에 대한 사실 칩)·show(프로필에 보일 칸)는 보냈을 때만 바꾼다 — 예전 앱이 저장해도 그대로 남는다
 * (account/profileFacts.ts, 모르는 칩은 버림). 배우는 언어(learns)가 없는 예전 앱의 facts는 저장된 배우는 언어를 지우지 않는다.
 * → { account } | { error: PHOTO_INVALID }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const found = await accountFromRequest(request);
  if ("response" in found) return found.response;

  const body = await readJsonBody<{
    nickname?: unknown;
    bio?: unknown;
    photo?: unknown;
    hidden?: unknown;
    readReceipts?: unknown;
    facts?: unknown;
    show?: unknown;
  }>(request);
  if (!body) return jsonWithCors(request, { error: "BAD_REQUEST" }, { status: 400 });

  let photo: string | null | undefined;
  if (body.photo === null) photo = null;
  else if (body.photo === undefined) photo = undefined;
  else {
    photo = cleanPhoto(body.photo);
    if (photo === null) return jsonWithCors(request, { error: "PHOTO_INVALID" }, { status: 400 });
  }

  const updated = await saveProfile(found.account, {
    nickname: cleanNickname(body.nickname),
    bio: cleanBio(body.bio),
    photo,
    hidden: typeof body.hidden === "boolean" ? body.hidden : undefined,
    readReceipts: typeof body.readReceipts === "boolean" ? body.readReceipts : undefined,
    facts: body.facts === undefined ? undefined : mergeFacts(body.facts, found.account.profile.facts),
    show: body.show === undefined ? undefined : cleanShow(body.show, found.account.profile.show),
  });
  return jsonWithCors(request, { account: await toPublic(updated) });
}
