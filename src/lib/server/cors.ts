import { NextRequest, NextResponse } from "next/server";

/**
 * CORS — 원본(english-chat-mvp `server/cors.ts`)에서 창구(doors)·앱 버전 신호·점검용 헤더를 뺀 것.
 *
 * 허용 주소: Capacitor 앱 웹뷰(https://localhost, capacitor://localhost) + 이 앱을 띄운 웹 주소.
 * 웹 주소는 Vercel 환경 변수 `ALLOWED_ORIGINS`(쉼표로 여러 개)로 더한다.
 */
const BASE_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost"];

function allowedOrigins(): string[] {
  const extra = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const vercel = process.env.VERCEL_URL?.trim();
  return [...BASE_ORIGINS, ...extra, ...(vercel ? [`https://${vercel}`] : [])];
}

/** 앱이 실제로 보내는 헤더. 빠지면 웹에서 사전 요청(preflight)이 막힌다. */
const ALLOWED_HEADERS = "Content-Type, x-auth-token";

function resolveAllowOrigin(request: NextRequest): string {
  const origin = request.headers.get("origin");
  if (!origin) return "https://localhost";
  const allowed = allowedOrigins().some((prefix) => origin === prefix || origin.startsWith(`${prefix}:`));
  return allowed ? origin : "https://localhost";
}

export function corsHeaders(request: NextRequest): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveAllowOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

export function corsPreflightResponse(request: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonWithCors(request: NextRequest, data: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: corsHeaders(request) });
}
