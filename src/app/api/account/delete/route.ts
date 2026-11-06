import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { accountFromRequest } from "@/lib/server/accountRequest";
import { deleteAccount } from "@/lib/server/accountStore";

export const dynamic = "force-dynamic";

/**
 * 계정 삭제: 계정·이메일/Google 연결·프로필·사진을 지운다.
 * 학습 기록은 계정 없이 이 기기의 익명 id에 남는다(로그인 전과 같음).
 *
 * POST → { ok: true }
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const found = await accountFromRequest(request);
  if ("response" in found) return found.response;
  await deleteAccount(found.account);
  return jsonWithCors(request, { ok: true });
}
