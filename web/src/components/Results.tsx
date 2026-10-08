"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { FIELD_MAP, UNIT } from "@/lib/fields";
import WatchStar from "@/components/WatchStar";
import { useSnapshot } from "@/hooks/useSnapshot";
import { fmt, fmtUnit, isSigned, type Row, tone } from "@/lib/screener";

export type Sort = { key: string; dir: 1 | -1 };
const PAGE = 100;

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

const label = (k: string) => FIELD_MAP[k]?.label ?? k;
/** 表頭加單位（億、張），數字欄才不會看不懂 */
const headLabel = (k: string) => {
  const f = FIELD_MAP[k];
  if (!f) return k;
  if (["yi", "yiRaw", "lots", "pct"].includes(f.format) && !f.label.includes(`（${UNIT[f.format]}）`)) return `${f.label}（${UNIT[f.format]}）`;
  return f.label;
};

export default function Results({
  rows, cols, sort, setSort, csvName, loading, empty, countLabel = "符合條件", badge, actions,
}: {
  rows: Row[]; cols: string[]; sort: Sort; setSort: (s: Sort) => void; csvName: string;
  loading?: boolean; empty?: ReactNode; countLabel?: string;
  /** 名稱下方額外顯示的內容（例如符合的策略） */
  badge?: (r: Row) => ReactNode;
  /** 每列最右邊的操作（例如排序、移除） */
  actions?: (r: Row) => ReactNode;
}) {
  const [limit, setLimit] = useState(PAGE);
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

  return (
    <section aria-live="polite">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink">
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
          className="rounded-md border border-line px-2.5 py-1 text-sm text-ink hover:border-accent disabled:opacity-40 lg:ml-auto">
          下載 CSV
        </button>
      </div>

      {!loading && rows.length === 0 && empty}

      {/* 表格自己捲動，表頭固定在上方（捲很長也看得到每欄是什麼） */}
      <div className="hidden max-h-[calc(100dvh-96px)] overflow-auto rounded-lg border border-line bg-surface lg:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs text-muted shadow-[0_1px_0_var(--line)]">
            <tr>
              <th scope="col" className="w-8 px-1"><span className="sr-only">自選</span></th>
              <Th label="代號／名稱" k="code" sort={sort} setSort={setSort} left />
              {cols.map((k) => <Th key={k} label={headLabel(k)} k={k} sort={sort} setSort={setSort} />)}
              {actions && <th scope="col"><span className="sr-only">操作</span></th>}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r) => (
              <tr key={r.code as string} className="border-t border-line hover:bg-surface-2">
                <td className="px-1 py-2 text-center"><WatchStar code={r.code as string} name={r.name as string} /></td>
                <td className="whitespace-nowrap px-3 py-2">
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

      <ul className="space-y-2 lg:hidden">
        {sorted.slice(0, limit).map((r) => (
          <li key={r.code as string} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-baseline justify-between gap-2">
              <WatchStar code={r.code as string} name={r.name as string} />
              <Link href={`/stock/${r.code}`} className="min-w-0 flex-1">
                <span className="num mr-2 text-sm text-muted">{r.code}</span>
                <span className="font-medium text-ink underline-offset-2 hover:underline">{r.name}</span>
                {r.market === "TPEX" && <span className="ml-1.5 text-xs text-muted">櫃</span>}
              </Link>
              <div className="num text-right">
                <span className="text-ink">{fmt(r.close, "price")}</span>
                <span className={`ml-2 text-sm ${toneClass(r.chg_pct)}`}>{fmt(r.chg_pct, "pct", true)}%</span>
              </div>
            </div>
            {badge && <div className="mt-1">{badge(r)}</div>}
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {cols.filter((k) => k !== "close" && k !== "chg_pct").map((k) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="truncate text-muted">{label(k)}</dt>
                  <dd className="num text-ink">{fmtUnit(r[k], FIELD_MAP[k]?.format ?? "num", isSigned(k))}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className="mt-2 flex justify-end gap-1">{actions(r)}</div>}
          </li>
        ))}
      </ul>

      {sorted.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)}
          className="mt-3 w-full rounded-md border border-line bg-surface py-2 text-sm text-ink hover:border-accent">
          顯示更多（還有 {(sorted.length - limit).toLocaleString()} 檔）
        </button>
      )}
    </section>
  );
}

// 融資融券、外資持股官方較晚公布（約 23:30）：傍晚到深夜這段時間，這些欄位還是前一交易日
const MARGIN_FIELDS = /^(margin_|short_|foreign_ratio)/;

function Th({ label, k, sort, setSort, left }: {
  label: string; k: string; sort: Sort; setSort: (s: Sort) => void; left?: boolean;
}) {
  const active = sort.key === k;
  const { snap } = useSnapshot();
  const m = snap?.meta;
  const lag = MARGIN_FIELDS.test(k) && m?.margin_asof && m.margin_asof < m.asof ? m.margin_asof : null;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={`whitespace-nowrap px-3 py-2 font-medium ${left ? "text-left" : "text-right"}`}>
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
  return (
    <td className={`num whitespace-nowrap px-3 py-2 text-right ${colored ? toneClass(r[k]) : "text-ink"}`}>
      {fmt(r[k], FIELD_MAP[k]?.format ?? "num", colored)}
    </td>
  );
}
