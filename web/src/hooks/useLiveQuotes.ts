"use client";

/** 盤中即時報價：進頁面抓一次；交易時段（週一至五 8:30–13:35，台灣時間）定時更新。沒開放時回傳 null。 */
import { useEffect, useState } from "react";
import type { LiveQuote } from "@/lib/fugle";

export function inSession(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const m = Number(p.hour) * 60 + Number(p.minute);
  return !["Sat", "Sun"].includes(p.weekday) && m >= 8 * 60 + 30 && m <= 13 * 60 + 35;
}

export function useLiveQuotes(codes: string[], everyMs: number) {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote> | null>(null);
  const key = codes.join(",");
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const tick = async () => {
      // 非交易時段只在進頁面時抓一次，之後每 5 分鐘看看開盤了沒
      if (!first && !inSession()) { timer = setTimeout(tick, 300_000); return; }
      if (!first && document.hidden) { timer = setTimeout(tick, everyMs); return; } // 分頁在背景：不耗額度
      first = false;
      try {
        const r = await fetch(`/api/quote?codes=${key}`, { cache: "no-store" });
        if (r.status === 403 || r.status === 404) return; // 沒開放：不再重試
        if (r.ok) {
          const j = await r.json();
          if (!stop) setQuotes((old) => ({ ...(old ?? {}), ...j.quotes }));
        }
      } catch { /* 網路暫時失敗：下一輪再試 */ }
      if (!stop) timer = setTimeout(tick, inSession() ? everyMs : 300_000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [key, everyMs]);
  return quotes;
}
