"use client";

/**
 * 電腦版頁首：往下捲時淡出收起、往上捲或回到頂端時再出現（手機的頁首本來就不固定，不受影響）。
 * 只在 <html> 標上 data-hdr="hidden"，實際樣式在 globals.css；黏在頁首下方的東西用 var(--hdr) 跟著移動。
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function HeaderAutoHide() {
  const path = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    let last = window.scrollY;
    const set = (hide: boolean) => { if (hide) root.dataset.hdr = "hidden"; else delete root.dataset.hdr; };
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last;
      if (y < 80) set(false);
      else if (dy > 8) set(true);
      else if (dy < -8) set(false);
      if (Math.abs(dy) > 8) last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); set(false); };
  }, [path]);
  return null;
}
