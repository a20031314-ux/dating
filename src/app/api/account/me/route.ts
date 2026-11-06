import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/server/cors";
import { accountFromRequest } from "@/lib/server/accountRequest";
import { toPublic } from "@/lib/server/accountStore";

export const dynamic = "force-dynamic";

/** GET → { account } | 401 { error: SIGNED_OUT | ACCOUNT_GONE } */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const found = await accountFromRequest(request);
  if ("response" in found) return found.response;
  return jsonWithCors(request, { account: await toPublic(found.account) });
}
