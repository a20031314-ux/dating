import { NextRequest, NextResponse } from "next/server";
import { readPhoto } from "@/lib/server/datingStore";
import { corsHeaders } from "@/lib/server/cors";
import { isAccountId } from "@/lib/server/socialStore";
import { isPhotoVersion } from "@/lib/dating/rules";

export const dynamic = "force-dynamic";

/**
 * GET ?u=<계정>&v=<버전> → 사진 파일. `<img src>`로 바로 쓰려고 로그인 헤더 없이 연다 —
 * 계정 id(24자리)와 사진 버전(12자리)을 알아야만 열린다. 버전이 바뀌면 주소도 바뀌어 오래 캐시해도 된다.
 * 사람이 많아지면 Vercel Blob·이미지 CDN으로 옮긴다(README 로드맵).
 */
export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("u");
  const version = request.nextUrl.searchParams.get("v");
  if (!isAccountId(user) || !isPhotoVersion(version)) return new NextResponse(null, { status: 400 });
  const dataUrl = await readPhoto(user, version);
  const match = dataUrl?.match(/^data:(image\/(?:jpeg|webp|png));base64,(.+)$/);
  if (!match) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(match[2], "base64"), {
    headers: {
      ...corsHeaders(request),
      "Content-Type": match[1],
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
