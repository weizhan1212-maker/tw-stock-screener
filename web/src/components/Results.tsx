"use client";

import { type ReactNode, useMemo, useState } from "react";
import { FIELD_MAP, UNIT } from "@/lib/fields";
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
  return ["yi", "yiRaw", "lots"].includes(f.format) ? `${f.label}（${UNIT[f.format]}）` : f.label;
};

export default function Results({
  rows, cols, sort, setSort, csvName, loading, empty, countLabel = "符合條件",
}: {
  rows: Row[]; cols: string[]; sort: Sort; setSort: (s: Sort) => void; csvName: string;
  loading?: boolean; empty?: ReactNode; countLabel?: string;
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

      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface lg:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
            <tr>
              <Th label="代號／名稱" k="code" sort={sort} setSort={setSort} left />
              {cols.map((k) => <Th key={k} label={headLabel(k)} k={k} sort={sort} setSort={setSort} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r) => (
              <tr key={r.code as string} className="border-t border-line hover:bg-surface-2">
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="num mr-2 text-muted">{r.code}</span>
                  <span className="text-ink">{r.name}</span>
                  {r.market === "TPEX" && <span className="ml-1.5 text-xs text-muted">櫃</span>}
                  {r.stale === 1 && <span className="ml-1.5 text-xs text-warn-ink">未交易</span>}
                </td>
                {cols.map((k) => <Cell key={k} r={r} k={k} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 lg:hidden">
        {sorted.slice(0, limit).map((r) => (
          <li key={r.code as string} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <span className="num mr-2 text-sm text-muted">{r.code}</span>
                <span className="font-medium text-ink">{r.name}</span>
                {r.market === "TPEX" && <span className="ml-1.5 text-xs text-muted">櫃</span>}
              </div>
              <div className="num text-right">
                <span className="text-ink">{fmt(r.close, "price")}</span>
                <span className={`ml-2 text-sm ${toneClass(r.chg_pct)}`}>{fmt(r.chg_pct, "pct", true)}%</span>
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {cols.filter((k) => k !== "close" && k !== "chg_pct").map((k) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="truncate text-muted">{label(k)}</dt>
                  <dd className="num text-ink">{fmtUnit(r[k], FIELD_MAP[k]?.format ?? "num", isSigned(k))}</dd>
                </div>
              ))}
            </dl>
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

function Th({ label, k, sort, setSort, left }: {
  label: string; k: string; sort: Sort; setSort: (s: Sort) => void; left?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={`whitespace-nowrap px-3 py-2 font-medium ${left ? "text-left" : "text-right"}`}>
      <button type="button" onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : -1 })}
        className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}
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
