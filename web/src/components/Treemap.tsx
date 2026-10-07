"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface TreeItem { key: string; label: string; sub?: string; value: number; change: number | null; href: string }

interface Tile { x: number; y: number; w: number; h: number; it: TreeItem }

/** Squarified treemap：面積 = value，盡量接近正方形。 */
function squarify(items: TreeItem[], W: number, H: number): Tile[] {
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total || !W || !H) return [];
  const list = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
    .map((it) => ({ it, a: (it.value / total) * W * H }));
  const out: Tile[] = [];
  let rect = { x: 0, y: 0, w: W, h: H };
  const worst = (row: { a: number }[], side: number) => {
    const s = row.reduce((x, r) => x + r.a, 0);
    const mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const place = (row: { it: TreeItem; a: number }[]) => {
    const s = row.reduce((x, r) => x + r.a, 0);
    if (rect.w >= rect.h) {
      const cw = s / rect.h; let y = rect.y;
      for (const r of row) { const h = r.a / cw; out.push({ x: rect.x, y, w: cw, h, it: r.it }); y += h; }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
    } else {
      const rh = s / rect.w; let x = rect.x;
      for (const r of row) { const w = r.a / rh; out.push({ x, y: rect.y, w, h: rh, it: r.it }); x += w; }
      rect = { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh };
    }
  };
  let row: typeof list = [];
  for (let i = 0; i < list.length;) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, list[i]], side) <= worst(row, side)) { row.push(list[i]); i++; }
    else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
}

function bg(change: number | null, scale: number) {
  if (change == null) return "var(--surface-2)";
  const t = Math.min(Math.abs(change) / scale, 1);
  if (t < 0.03) return "var(--surface-2)";
  return `color-mix(in srgb, var(${change > 0 ? "--up" : "--down"}) ${Math.round(18 + t * 62)}%, var(--surface-2))`;
}

/** 紅漲綠跌熱力圖；格子大小 = 市值。 */
export default function Treemap({ items, scale, fmt }: { items: TreeItem[]; scale: number; fmt: (v: number | null) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = w < 640 ? Math.round(w * 1.25) : Math.round(w * 0.5);
  const tiles = squarify(items, w, h);
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-lg border border-line" style={{ height: h || 300 }}>
      {tiles.map(({ x, y, w: tw, h: th, it }) => {
        const show = tw > 46 && th > 26;
        const strong = it.change != null && Math.abs(it.change) / scale > 0.6;
        return (
          <Link
            key={it.key}
            href={it.href}
            title={`${it.label}${it.sub ? `（${it.sub}）` : ""} ${fmt(it.change)}`}
            className="absolute flex flex-col items-center justify-center overflow-hidden border border-[var(--paper)] px-0.5 text-center leading-tight hover:brightness-110"
            style={{ left: x, top: y, width: tw, height: th, background: bg(it.change, scale), color: strong ? "#fff" : "var(--ink)" }}
          >
            {show && (
              <>
                <span className="max-w-full truncate text-[12px] font-medium" style={{ fontSize: Math.min(15, Math.max(11, Math.sqrt(tw * th) / 7)) }}>{it.label}</span>
                <span className="num text-[11px]">{fmt(it.change)}</span>
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}
