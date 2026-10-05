"use client";

import { useWatchlist } from "@/hooks/useWatchlist";

/** 加入／移除自選股的星號按鈕。 */
export default function WatchStar({ code, name, size = "sm" }: { code: string; name?: string; size?: "sm" | "md" }) {
  const w = useWatchlist();
  const on = w.has(code);
  const label = `${on ? "從自選股移除" : "加入自選股"}${name ? `：${name}` : ""}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); w.toggle(code); }}
      disabled={w.codes == null}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={size === "md"
        ? `inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm ${on ? "border-warn-ink/40 bg-warn-bg text-warn-ink" : "border-line text-muted hover:text-ink"}`
        : `inline-flex h-6 w-6 items-center justify-center rounded text-base leading-none ${on ? "text-warn-ink" : "text-muted/60 hover:text-ink"}`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      {size === "md" && <span>{on ? "已加入自選" : "加入自選"}</span>}
    </button>
  );
}
