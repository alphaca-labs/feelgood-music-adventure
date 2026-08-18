import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { siteUrl } from "@/lib/site";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "LET ME LOVE YOU — 필굿뮤직 어드벤처",
  description:
    "두 개의 버튼, 세 개의 무대, 한 번의 완주. 타이거 JK와 윤미래로 즐기는 110초짜리 도트 러너.",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    title: "LET ME LOVE YOU — 필굿뮤직 어드벤처",
    description: "정글 · 도시 · 무대를 달리는 110초 도트 러너",
    url: siteUrl,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0412",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The play scene is a fixed 320x180 integer-scaled canvas; user zoom would break the grid.
  maximumScale: 1,
};

const RootLayout = ({ children }: { readonly children: ReactNode }) => (
  <html lang="ko">
    <body>{children}</body>
  </html>
);

export default RootLayout;
