import type { Metadata, Viewport } from "next";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "台股選股",
  description: "台股盤後選股：基本面、技術面、籌碼面篩選",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 在畫面出現前套用深淺色，避免閃一下
const themeScript = `try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" />
      </head>
      <body className="min-h-dvh flex flex-col antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="whitespace-nowrap text-[17px] font-bold tracking-wide text-ink">
              台股選股
            </Link>
            <nav className="order-last -mx-2.5 flex w-full gap-1 overflow-x-auto whitespace-nowrap text-sm sm:order-none sm:mx-0 sm:w-auto">
              <Link href="/" className="rounded-md px-2.5 py-1 text-ink hover:bg-surface-2">
                策略選股
              </Link>
              <Link href="/screener" className="rounded-md px-2.5 py-1 text-ink hover:bg-surface-2">
                自訂篩選
              </Link>
              <Link href="/market" className="rounded-md px-2.5 py-1 text-ink hover:bg-surface-2">
                市場總覽
              </Link>
              <Link href="/ranking" className="rounded-md px-2.5 py-1 text-ink hover:bg-surface-2">
                排行榜
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <UserMenu />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line px-4 py-4 text-center text-xs leading-relaxed text-muted">
          本網站為資料篩選工具，所有結果僅供參考，不構成任何投資建議。資料來源：臺灣證券交易所、證券櫃檯買賣中心、FinMind。
        </footer>
      </body>
    </html>
  );
}
