"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { FIELD_MAP, UNIT } from "@/lib/fields";
import WatchStar from "@/components/WatchStar";
import { useSnapshot } from "@/hooks/useSnapshot";
import { fmt, fmtUnit, isSigned, type Row, tone } from "@/lib/screener";

export type Sort = { key: string; dir: 1 | -1 };
const PAGE = 100;
const MOBILE_PAGE = 20;

export function sortRows(rows: Row[], sort: Sort) {
  const k = sort.key;
  return [...rows].sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
}

export function toneClass(v: unknown) {
  const t = tone(v);
  return t === "up" ? "text-up" : t === "down" ? "text-down" : "text-muted";
}

/** 漲跌停（漲跌幅 ±9.5% 以上，近似值）：依台股慣例漲停紅底白字、跌停綠底白字 */
export function limitClass(v: unknown) {
  const x = typeof v === "number" ? v : null;
  if (x == null) return null;
  return x >= 9.5 ? "rounded bg-up px-1 font-medium text-white" : x <= -9.5 ? "rounded bg-down px-1 font-medium text-white" : null;
}

/** 表頭跟著整頁捲動「黏」在網站頁首下方（表格可以橫向捲，所以不能用 CSS sticky） */
function useStickyHead(top = 56) {
  const wrap = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const w = wrap.current, h = head.current;
      if (!w || !h) return;
      const r = w.getBoundingClientRect();
      const y = Math.max(0, Math.min(top - r.top, r.height - h.offsetHeight));
      h.style.transform = y > 0 ? `translateY(${y}px)` : "";
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    update();
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); if (raf) cancelAnimationFrame(raf); };
  }, [top]);
  return { wrap, head };
}

const label = (k: string) => FIELD_MAP[k]?.label ?? k;
/** 表頭加單位（億、張），數字欄才不會看不懂 */
const headLabel = (k: string) => {
  const f = FIELD_MAP[k];
  if (!f) return k;
  if (["yi", "yiRaw", "lots", "pct"].includes(f.format) && !f.label.includes(`（${UNIT[f.format]}）`)) return `${f.label}（${UNIT[f.format]}）`;
  return f.label;
};

export default function Results({
  rows, cols, sort, setSort, csvName, loading, empty, countLabel = "符合條件", badge, actions, mobileCount = true,
}: {
  /** 手機上顯示「符合 N 檔」（頁面已有固定列顯示時傳 false） */
  mobileCount?: boolean;
  rows: Row[]; cols: string[]; sort: Sort; setSort: (s: Sort) => void; csvName: string;
  loading?: boolean; empty?: ReactNode; countLabel?: string;
  /** 名稱下方額外顯示的內容（例如符合的策略） */
  badge?: (r: Row) => ReactNode;
  /** 每列最右邊的操作（例如排序、移除） */
  actions?: (r: Row) => ReactNode;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [mLimit, setMLimit] = useState(MOBILE_PAGE);           // 手機一次 20 檔
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  function exportCsv() {
    const header = ["代號", "名稱", "市場", ...cols.map(label)];
    const lines = sorted.map((r) =>
      [r.code, r.name, r.market === "TWSE" ? "上市" : "上櫃",
        ...cols.map((k) => (FIELD_MAP[k]?.format === "yi" && typeof r[k] === "number" ? (r[k] as number) / 1e8 : r[k]) ?? "")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const { wrap, head } = useStickyHead();
  return (
    <section aria-live="polite">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className={`text-sm text-ink ${mobileCount ? "" : "hidden lg:block"}`}>
          {loading ? "載入中…" : <>{countLabel} <b className="num text-base">{rows.length.toLocaleString()}</b> 檔</>}
        </p>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-muted lg:hidden">
          排序
          <select
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => { const [key, d] = e.target.value.split(":"); setSort({ key, dir: d === "1" ? 1 : -1 }); }}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-ink"
          >
            {cols.flatMap((k) => [
              <option key={k + "-1"} value={`${k}:-1`}>{label(k)} 高→低</option>,
              <option key={k + "1"} value={`${k}:1`}>{label(k)} 低→高</option>,
            ])}
          </select>
        </label>
        <button type="button" onClick={exportCsv} disabled={!rows.length}
          className="hidden rounded-md border border-line px-2.5 py-1 text-sm text-ink hover:border-accent disabled:opacity-40 lg:ml-auto lg:block">
          下載 CSV
        </button>
        {/* 手機：不常用的功能收進 ⋯ */}
        <details className="relative lg:hidden">
          <summary aria-label="更多功能" className="cursor-pointer list-none rounded-md border border-line px-2 py-0.5 text-ink">⋯</summary>
          <div className="absolute right-0 z-30 mt-1 w-32 rounded-md border border-line bg-surface p-1 shadow-lg">
            <button type="button" onClick={exportCsv} disabled={!rows.length} className="w-full rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">下載 CSV</button>
          </div>
        </details>
      </div>

      {!loading && rows.length === 0 && empty}

      {/* 表格跟著整頁捲動（不再有內層捲軸）；太寬時可橫向捲，代號／名稱欄固定在左邊，表頭固定在頁首下方 */}
      <div ref={wrap} className="hidden overflow-x-auto rounded-lg border border-line bg-surface lg:block">
        <table className="w-full text-sm">
          <thead ref={head} className="relative z-20 bg-surface-2 text-left text-xs text-muted shadow-[0_1px_0_var(--line)]">
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-8 bg-surface-2 px-1"><span className="sr-only">自選</span></th>
              <Th label="代號／名稱" k="code" sort={sort} setSort={setSort} left sticky />
              {cols.map((k) => <Th key={k} label={headLabel(k)} k={k} sort={sort} setSort={setSort} />)}
              {actions && <th scope="col"><span className="sr-only">操作</span></th>}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r) => (
              <tr key={r.code as string} className="group/row border-t border-line hover:bg-surface-2">
                <td className="sticky left-0 z-10 w-8 bg-surface px-1 py-2 text-center group-hover/row:bg-surface-2"><WatchStar code={r.code as string} name={r.name as string} /></td>
                <td className="sticky left-8 z-10 whitespace-nowrap bg-surface px-3 py-2 shadow-[1px_0_0_var(--line)] group-hover/row:bg-surface-2">
                  <Link href={`/stock/${r.code}`} className="group">
                    <span className="num mr-2 text-muted">{r.code}</span>
                    <span className="text-ink group-hover:text-accent group-hover:underline">{r.name}</span>
                  </Link>
                  {r.market === "TPEX" && <span className="ml-1.5 text-xs text-muted">櫃</span>}
                  {r.stale === 1 && <span className="ml-1.5 text-xs text-warn-ink">未交易</span>}
                  {badge && <div className="mt-0.5 whitespace-normal">{badge(r)}</div>}
                </td>
                {cols.map((k) => <Cell key={k} r={r} k={k} />)}
                {actions && <td className="whitespace-nowrap px-2 py-2 text-right">{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 手機：兩行緊湊列。第一行代號、名稱、股價、漲跌；第二行只放目前排序的指標（完整數據點進個股頁看） */}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface lg:hidden">
        {sorted.slice(0, mLimit).map((r) => {
          const k = ["close", "chg_pct", "code"].includes(sort.key) ? cols.find((c) => c !== "close" && c !== "chg_pct") : sort.key;
          const lim = limitClass(r.chg_pct);
          return (
            <li key={r.code as string} className="flex items-center gap-2 px-3 py-2">
              <WatchStar code={r.code as string} name={r.name as string} />
              <Link href={`/stock/${r.code}`} className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="num text-xs text-muted">{r.code}</span>
                  <span className="truncate font-medium text-ink">{r.name}</span>
                  {r.market === "TPEX" && <span className="text-[10px] text-muted">櫃</span>}
                  <span className="num ml-auto shrink-0 text-ink">{fmt(r.close, "price")}</span>
                  <span className={`num w-16 shrink-0 text-right text-sm ${lim ? "" : toneClass(r.chg_pct)}`}>
                    <span className={lim ?? ""}>{fmt(r.chg_pct, "pct", true)}%</span>
                  </span>
                </div>
                {k && (
                  <div className="mt-0.5 flex justify-between gap-2 text-xs">
                    <span className="truncate text-muted">{label(k)}</span>
                    <span className={`num ${isSigned(k) ? toneClass(r[k]) : "text-ink"}`}>{fmtUnit(r[k], FIELD_MAP[k]?.format ?? "num", isSigned(k))}</span>
                  </div>
                )}
                {badge && <div className="mt-0.5">{badge(r)}</div>}
              </Link>
              {actions && <div className="flex shrink-0 gap-1">{actions(r)}</div>}
            </li>
          );
        })}
      </ul>
      {sorted.length > mLimit && (
        <button type="button" onClick={() => setMLimit((l) => l + MOBILE_PAGE)}
          className="mt-2 w-full rounded-md border border-line bg-surface py-2 text-sm text-ink lg:hidden">
          載入更多（還有 {(sorted.length - mLimit).toLocaleString()} 檔）
        </button>
      )}

      {sorted.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)}
          className="mt-3 hidden w-full rounded-md border border-line bg-surface py-2 text-sm text-ink hover:border-accent lg:block">
          顯示更多（還有 {(sorted.length - limit).toLocaleString()} 檔）
        </button>
      )}
    </section>
  );
}

// 融資融券、外資持股官方較晚公布（約 23:30）：傍晚到深夜這段時間，這些欄位還是前一交易日
const MARGIN_FIELDS = /^(margin_|short_|foreign_ratio)/;

function Th({ label, k, sort, setSort, left, sticky }: {
  label: string; k: string; sort: Sort; setSort: (s: Sort) => void; left?: boolean; sticky?: boolean;
}) {
  const active = sort.key === k;
  const { snap } = useSnapshot();
  const m = snap?.meta;
  const lag = MARGIN_FIELDS.test(k) && m?.margin_asof && m.margin_asof < m.asof ? m.margin_asof : null;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={`whitespace-nowrap px-3 py-2 font-medium ${left ? "text-left" : "text-right"} ${sticky ? "sticky left-8 z-10 bg-surface-2 shadow-[1px_0_0_var(--line)]" : ""}`}>
      <button type="button" onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : -1 })}
        title={FIELD_MAP[k]?.help ? `${FIELD_MAP[k].help}${UNIT[FIELD_MAP[k].format] ? `（單位：${UNIT[FIELD_MAP[k].format]}）` : ""}` : undefined}
        className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""} ${FIELD_MAP[k]?.help ? "cursor-help underline decoration-dotted decoration-1 underline-offset-4" : ""}`}>
        {label}
        {lag && <span title={`這一欄還是 ${lag} 的資料（官方較晚公布，約 23:30 更新）`} className="rounded bg-warn-bg px-1 text-[10px] font-normal text-warn-ink no-underline">T-1</span>}
        <span aria-hidden className="w-2 text-[10px]">{active ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function Cell({ r, k }: { r: Row; k: string }) {
  const colored = isSigned(k);
  const lim = k === "chg_pct" ? limitClass(r[k]) : null;
  const fill = k === "div_fill" && r[k] === "貼息" ? "text-down" : null;
  return (
    <td className={`num whitespace-nowrap px-3 py-2 text-right ${fill ?? (colored && !lim ? toneClass(r[k]) : "text-ink")}`}>
      {lim ? <span className={lim} title={(r[k] as number) > 0 ? "漲停" : "跌停"}>{fmt(r[k], FIELD_MAP[k]?.format ?? "num", colored)}</span>
        : fmt(r[k], FIELD_MAP[k]?.format ?? "num", colored)}
    </td>
  );
}
