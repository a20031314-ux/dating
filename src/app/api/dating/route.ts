import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { requestAuth } from "@/lib/server/request";
import { readAccount } from "@/lib/server/accountStore";
import { blockedEitherWay, isAccountId } from "@/lib/server/socialStore";
import { suspendedResponse } from "@/lib/server/suspension";
import {
  addPhoto,
  discover,
  like,
  likedMe,
  likesLeft,
  pass,
  readDatingProfile,
  readMatches,
  removePhoto,
  reorderPhotos,
  saveDatingProfile,
  touchActive,
  unmatch,
  isMatched,
} from "@/lib/server/datingStore";
import { adultVerifyRequired, cardsFor, isVerifiedAdult } from "@/lib/server/datingCards";
import { threadIdFor } from "@/lib/rooms/dm";
import {
  DISCOVER_BATCH,
  cleanWant,
  isBirthYear,
  isGender,
  isPhotoDataUrl,
  isPhotoVersion,
  isRegion,
  type DatingProfile,
  type MatchRow,
} from "@/lib/dating/rules";

export const dynamic = "force-dynamic";

/**
 * 데이팅(새로 만든 부분). 모두 로그인해야 한다.
 *
 *   me                                → { profile | null, likesLeft, verified, verifyRequired }
 *   save { gender, birthYear, region, want, visible } → { profile }
 *   photoAdd { image }                → { profile }      (data URL, 앱이 줄여서 보냄)
 *   photoRemove { version }           → { profile }
 *   photoOrder { order }              → { profile }      (앞이 대표 사진)
 *   discover                          → { cards }        (서로 조건이 맞는 사람, 이미 본 사람 제외)
 *   like { target }                   → { matched, threadId? }
 *   pass { target }                   → { ok }
 *   likedMe                           → { cards }        (나에게 좋아요, 내가 아직 답 안 함)
 *   matches                           → { matches: MatchRow[] }
 *   unmatch { target }                → { ok }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

const bad = (request: NextRequest, error: string, status = 400) => jsonWithCors(request, { error }, { status });

/** 쓰기 동작 — 운영자 정지면 막는다. */
const WRITES = ["save", "photoAdd", "photoRemove", "photoOrder", "like"];
/** 성인인증을 요구할 때 인증해야 하는 동작. */
const NEEDS_ADULT = ["discover", "like", "likedMe"];

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
  const verifyRequired = adultVerifyRequired();
  if (verifyRequired && NEEDS_ADULT.includes(action) && !(await isVerifiedAdult(me))) {
    return bad(request, "UNVERIFIED", 403);
  }

  const profile = await readDatingProfile(me);

  if (action === "me") {
    await touchActive(me, profile);
    return jsonWithCors(request, {
      profile,
      likesLeft: await likesLeft(me),
      verified: await isVerifiedAdult(me),
      verifyRequired,
    });
  }

  if (action === "save") {
    if (!isGender(body.gender)) return bad(request, "BAD_GENDER");
    if (!isBirthYear(body.birthYear)) return bad(request, "BAD_BIRTH_YEAR");
    if (!isRegion(body.region)) return bad(request, "BAD_REGION");
    const next: DatingProfile = {
      gender: body.gender,
      birthYear: body.birthYear,
      region: body.region,
      want: cleanWant(body.want, { gender: body.gender }),
      photos: profile?.photos ?? [],
      visible: body.visible !== false,
      updatedAt: Date.now(),
    };
    return jsonWithCors(request, { profile: await saveDatingProfile(me, next) });
  }

  if (action === "photoAdd" || action === "photoRemove" || action === "photoOrder") {
    let result;
    if (action === "photoAdd") {
      if (!isPhotoDataUrl(body.image)) return bad(request, "PHOTO_INVALID");
      result = await addPhoto(me, body.image);
    } else if (action === "photoRemove") {
      if (!isPhotoVersion(body.version)) return bad(request, "BAD_VERSION");
      result = await removePhoto(me, body.version);
    } else {
      const order = Array.isArray(body.order) ? body.order.filter(isPhotoVersion) : [];
      result = await reorderPhotos(me, order);
    }
    if ("error" in result) return bad(request, result.error, result.error === "FULL" ? 409 : 400);
    return jsonWithCors(request, { profile: result.ok });
  }

  if (action === "matches") {
    const rows = await readMatches(me);
    const cards = await cardsFor(rows.map((row) => row.id));
    const at = new Map(rows.map((row) => [row.id, row.at]));
    const matches: MatchRow[] = cards.map((card) => ({ card, threadId: threadIdFor(me, card.id), matchedAt: at.get(card.id) ?? 0 }));
    return jsonWithCors(request, { matches });
  }

  if (action === "unmatch") {
    if (!isAccountId(body.target) || body.target === me) return bad(request, "BAD_TARGET");
    await unmatch(me, body.target);
    return jsonWithCors(request, { ok: true });
  }

  // 아래는 내 데이팅 프로필이 있어야 한다.
  if (!profile) return bad(request, "NO_PROFILE", 409);

  if (action === "discover") {
    await touchActive(me, profile);
    const ids = await discover({
      me,
      profile,
      limit: DISCOVER_BATCH,
      blocked: (other) => blockedEitherWay(me, other),
      allowed: verifyRequired ? isVerifiedAdult : undefined,
    });
    return jsonWithCors(request, { cards: await cardsFor(ids) });
  }

  if (action === "likedMe") {
    const ids = await likedMe(me);
    const visible: string[] = [];
    for (const id of ids) if (!(await blockedEitherWay(me, id))) visible.push(id);
    const cards = (await cardsFor(visible)).map((card) => ({ ...card, likedMe: true }));
    return jsonWithCors(request, { cards });
  }

  if (action === "like" || action === "pass") {
    if (!isAccountId(body.target) || body.target === me) return bad(request, "BAD_TARGET");
    const target = body.target;
    if (!(await readAccount(target)) || !(await readDatingProfile(target))) return bad(request, "NO_ACCOUNT", 404);
    if (await blockedEitherWay(me, target)) return bad(request, "BLOCKED", 403);
    if (action === "pass") {
      await pass(me, target);
      return jsonWithCors(request, { ok: true });
    }
    if (verifyRequired && !(await isVerifiedAdult(target))) return bad(request, "TARGET_UNVERIFIED", 403);
    if (await isMatched(me, target)) return jsonWithCors(request, { matched: true, threadId: threadIdFor(me, target) });
    const result = await like(me, target);
    if (!result.ok) return bad(request, result.error, result.error === "LIMIT" ? 429 : 400);
    return jsonWithCors(request, result.matched ? { matched: true, threadId: result.threadId } : { matched: false });
  }

  return bad(request, "UNKNOWN_ACTION");
}
