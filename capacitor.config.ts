import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 앱 id는 Play에 한 번 올리면 바꿀 수 없다 — 첫 업로드 전에 정한다(README "출시 전 확인").
 * 라이브 리로드: CAPACITOR_DEV_SERVER_URL=http://<PC IP>:3000
 */
const devServerUrl = process.env.CAPACITOR_DEV_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.a20031314.datingapp",
  appName: "dating-app",
  webDir: "www",
  android: { allowMixedContent: false },
  plugins: {
    CapacitorHttp: { enabled: true },
    // Google 로그인만(원본과 같음).
    SocialLogin: { providers: { google: true, facebook: false, apple: false, twitter: false } },
  },
  ...(devServerUrl
    ? { server: { url: devServerUrl, cleartext: devServerUrl.startsWith("http://"), androidScheme: "https" } }
    : {}),
};

export default config;
