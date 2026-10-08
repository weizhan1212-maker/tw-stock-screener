import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import StockSearch from "@/components/StockSearch";
import { NavTracker } from "@/components/BackLink";
import HideOnAbout from "@/components/HideOnAbout";
import { DesktopNav, MobileTabBar } from "@/components/SiteNav";
import UserMenu from "@/components/UserMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "股見未來",
  applicationName: "股見未來",
  description: "台股盤後選股：基本面、技術面、籌碼面篩選",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 在畫面出現前套用深淺色，避免閃一下
const themeScript = `try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 沒登入（例如看落地頁、登入頁）時只顯示品牌與登入，不顯示站內選單
  const user = process.env.SKIP_AUTH === "1" && !process.env.VERCEL ? true : !!(await auth())?.user;
  return (
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" />
      </head>
      <body className={`flex min-h-dvh flex-col antialiased ${user ? "pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0" : ""}`}>
        <HideOnAbout>
        <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4">
            <Link href={user ? "/" : "/about"} className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[17px] font-bold tracking-wide text-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
              股見未來
            </Link>
            {user ? <DesktopNav /> : null}
            <div className="flex-1 lg:hidden" />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {user ? <StockSearch /> : <Link href="/login" className="text-sm text-accent hover:underline">登入</Link>}
              <UserMenu />
            </div>
          </div>
        </header>
        {user && <MobileTabBar />}
        </HideOnAbout>
        <NavTracker />
        <main className="flex-1">{children}</main>
        <HideOnAbout>
        <footer className="border-t border-line px-4 py-4 text-center text-xs leading-relaxed text-muted">
          本網站為資料篩選工具，所有結果僅供參考，不構成任何投資建議。資料來源：臺灣證券交易所、證券櫃檯買賣中心、FinMind。
        </footer>
        </HideOnAbout>
      </body>
    </html>
  );
}
