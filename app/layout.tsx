import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "国内高尔夫赛事报名日历",
  description: "汇总国内女子、青少年与业余高尔夫赛事的日期、报名状态和官方入口。",
  icons: { icon: "/site/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
