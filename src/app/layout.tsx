import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dating-app",
  description: "서로 좋아요를 누르면 대화가 열리는 데이팅 앱",
};

export const viewport: Viewport = { themeColor: "#1c1622", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full bg-night text-ink">{children}</body>
    </html>
  );
}
