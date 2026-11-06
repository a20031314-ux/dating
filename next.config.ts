import type { NextConfig } from "next";

/** `scripts/build-capacitor.mjs`가 켠다 — 앱(Capacitor)에 싣는 정적 화면만 만들 때. */
const capacitorStatic = process.env.CAPACITOR_STATIC === "1";

const nextConfig: NextConfig = {
  ...(capacitorStatic ? { output: "export" as const } : {}),
  images: { unoptimized: true },
};

export default nextConfig;
