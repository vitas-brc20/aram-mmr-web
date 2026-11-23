import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "칼바람 분석기 · ARAM Mayhem 웹",
  description:
    "리그 오브 레전드 일반 칼바람 · 증강 칼바람 메타 통계, 챔피언/아이템/룬/증강 티어 분석, 증바람 MMR 조회 및 사주풀이",
  icons: {
    icon: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body data-mode="standard">{children}</body>
    </html>
  );
}
