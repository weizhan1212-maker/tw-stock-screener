"use client";

/**
 * 站內導覽：
 * - 電腦（寬 1024 以上）：頁首一排連結，目前頁面加底色
 * - 手機、平板：底部分頁列（市場、策略、篩選、自選、更多），往下捲收起、往上捲回來；「更多」從底部展開其他頁面
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type NavGroup = "行情" | "選股" | "我的";
export const NAV: { href: string; label: string; short?: string; group: NavGroup }[] = [
  { href: "/", label: "市場總覽", short: "市場", group: "行情" },
  { href: "/industry", label: "產業", group: "行情" },
  { href: "/etf", label: "ETF", group: "行情" },
  { href: "/ranking", label: "排行榜", group: "行情" },
  { href: "/strategy", label: "策略選股", short: "策略", group: "選股" },
  { href: "/screener", label: "自訂篩選", short: "篩選", group: "選股" },
  { href: "/backtest", label: "回測", group: "選股" },
  { href: "/watchlist", label: "自選股", short: "自選", group: "我的" },
  { href: "/portfolio", label: "投資組合", group: "我的" },
  { href: "/alerts", label: "警報", group: "我的" },
];
const GROUPS: NavGroup[] = ["行情", "選股", "我的"];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" || path.startsWith("/market") : path.startsWith(href));

export function DesktopNav() {
  const path = usePathname();
  return (
    <nav aria-label="主選單" className="hidden min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-sm lg:flex">
      {GROUPS.map((g, gi) => (
        <div key={g} role="group" aria-label={g} className={`flex items-center gap-0.5 ${gi ? "ml-2 border-l border-line pl-2" : ""}`}>
          {NAV.filter((n) => n.group === g).map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 ${isActive(path, n.href) ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-2"}`}>
              {n.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

const ICON: Record<string, React.ReactNode> = {
  "/": <path d="M3 17l5-5 4 4 8-9M14 7h6v6" />,
  "/strategy": <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" />,
  "/screener": <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  "/watchlist": <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
};

export function MobileTabBar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);              // eslint-disable-line react-hooks/set-state-in-effect -- 換頁時關掉「更多」
  // 往下捲收起底部列、往上捲或回到頂端時再出現（不一直占著畫面）
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last;
      if (y < 80) setHidden(false);
      else if (dy > 8) setHidden(true);
      else if (dy < -8) setHidden(false);
      if (Math.abs(dy) > 8) last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { setHidden(false); }, [path]);            // eslint-disable-line react-hooks/set-state-in-effect -- 換頁後底部列回來
  const main = NAV.filter((n) => n.short);
  const more = NAV.filter((n) => !n.short);
  const moreActive = more.some((n) => isActive(path, n.href));
  const tab = (active: boolean) => `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] ${active ? "text-accent" : "text-muted"}`;
  return (
    <>
      {open && <button type="button" aria-label="關閉" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/30 lg:hidden" />}
      {open && (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-50 rounded-t-2xl border-t border-line bg-surface p-3 shadow-2xl lg:hidden">
          <div className="space-y-3">
            {GROUPS.map((g) => (
              <div key={g}>
                <div className="mb-1.5 text-xs font-medium text-muted">{g}</div>
                <div className="grid grid-cols-4 gap-2">
                  {NAV.filter((n) => n.group === g).map((n) => (
                    <Link key={n.href} href={n.href} className={`rounded-lg border px-1 py-2.5 text-center text-sm ${isActive(path, n.href) ? "border-accent bg-accent-soft text-accent" : "border-line text-ink"}`}>
                      {n.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <nav aria-label="主選單" className={`fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] transition-transform duration-200 lg:hidden ${hidden && !open ? "translate-y-full" : ""}`}>
        {main.map((n) => (
          <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined} className={tab(isActive(path, n.href))}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{ICON[n.href]}</svg>
            {n.short}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={tab(open || moreActive)}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">{ICON.more}</svg>
          更多
        </button>
      </nav>
    </>
  );
}
