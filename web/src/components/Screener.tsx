"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FIELD_MAP, FIELDS, GROUPS, QUICK, UNIT, type Field } from "@/lib/fields";
import {
  type Condition, decode, decodeConds, encodeConds, fmt, fmtUnit, isSigned, funnel, inUniverse, type Market, type Op,
  type RawSnapshot, type Row, type Snapshot, tone, type Universe,
} from "@/lib/screener";

const BASE_COLS = ["close", "chg_pct", "volume_lots", "market_cap"];
const TAIL_COLS = ["pe", "dividend_yield"];
const PAGE = 100;
let seq = 0;
const newId = () => `c${Date.now().toString(36)}${seq++}`;

// ---------- 小元件 ----------

function Help({ field }: { field: Field }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${field.label}是什麼`}
        aria-expanded={open}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] leading-none text-muted hover:border-accent hover:text-accent"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-6 z-30 w-64 rounded-lg border border-line bg-surface p-3 text-left text-[13px] font-normal leading-relaxed text-ink shadow-lg"
        >
          <span className="mb-1 block font-medium">{field.label}</span>
          {field.help}
        </span>
      )}
    </span>
  );
}

function FieldSelect({ value, onChange, placeholder }: { value: string; onChange: (k: string) => void; placeholder?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {FIELDS.filter((f) => f.group === g).map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function NumInput({ value, onChange, label }: { value?: number; onChange: (v?: number) => void; label: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value.trim() === "" ? undefined : Number(e.target.value);
        if (n === undefined || !Number.isNaN(n)) onChange(n);
      }}
      className="num w-20 rounded-md border border-line bg-surface px-2 py-1.5 text-right text-sm text-ink"
    />
  );
}

function ConditionRow({
  c, step, total, onChange, onRemove,
}: {
  c: Condition; step?: { remaining: number; alone: number }; total: number;
  onChange: (c: Condition) => void; onRemove: () => void;
}) {
  const f = FIELD_MAP[c.field];
  const unit = UNIT[f.format] ?? "";
  const width = total ? Math.max(2, ((step?.remaining ?? 0) / total) * 100) : 0;
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center text-sm font-medium text-ink">
            {f.label}
            <Help field={f} />
          </div>
          {f.format === "bool" ? (
            <p className="mt-1.5 text-sm text-muted">符合即保留</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
              <select
                value={c.op}
                onChange={(e) => onChange({ ...c, op: e.target.value as Op })}
                aria-label="比較方式"
                className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-ink"
              >
                <option value="ge">≥</option>
                <option value="le">≤</option>
                <option value="between">介於</option>
              </select>
              <NumInput value={c.a} onChange={(a) => onChange({ ...c, a })} label="數值" />
              {c.op === "between" && (
                <>
                  <span className="text-muted">到</span>
                  <NumInput value={c.b} onChange={(b) => onChange({ ...c, b })} label="上限" />
                </>
              )}
              <span className="text-muted">{unit}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除條件：${f.label}`}
          className="rounded px-1.5 text-lg leading-none text-muted hover:text-up"
        >
          ×
        </button>
      </div>
      {/* 篩選漏斗：套用到這個條件為止還剩幾檔 */}
      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${width}%` }} />
        </div>
        <div className="num mt-1 flex justify-between text-xs text-muted">
          <span>剩 {step?.remaining ?? "—"} 檔</span>
          <span>單獨符合 {step?.alone ?? "—"} 檔</span>
        </div>
      </div>
    </li>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5 text-sm">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded px-2.5 py-1 ${value === v ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------- 主畫面 ----------

export default function Screener() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 初始條件從網址讀（可以把篩選結果的網址傳給朋友）
  const params = useSearchParams();
  const [conds, setConds] = useState<Condition[]>(() => decodeConds(params.get("c")));
  const [universe, setUniverse] = useState<Universe>(() => {
    const u = params.get("u");
    return u === "stock" || u === "etf" ? u : "all";
  });
  const [market, setMarket] = useState<Market>(() => {
    const m = params.get("m");
    return m === "TWSE" || m === "TPEX" ? m : "all";
  });
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>(() => {
    const [key, d] = (params.get("s") ?? "").split(":");
    return FIELD_MAP[key] || key === "code" ? { key, dir: d === "asc" ? 1 : -1 } : { key: "market_cap", dir: -1 };
  });
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState("");
  useEffect(() => {
    const q = new URLSearchParams();
    if (conds.length) q.set("c", encodeConds(conds));
    if (universe !== "all") q.set("u", universe);
    if (market !== "all") q.set("m", market);
    q.set("s", `${sort.key}:${sort.dir === 1 ? "asc" : "desc"}`);
    window.history.replaceState(null, "", `?${q.toString()}`);
  }, [conds, universe, market, sort]);

  useEffect(() => {
    fetch("/api/snapshot")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setSnap(decode(j as RawSnapshot));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const pool = useMemo(() => (snap ? snap.rows.filter((r) => inUniverse(r, universe, market)) : []), [snap, universe, market]);
  const { result, steps } = useMemo(() => funnel(pool, conds), [pool, conds]);
  const stepMap = Object.fromEntries(steps.map((s) => [s.id, s]));
  const sorted = useMemo(() => {
    const k = sort.key;
    return [...result].sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [result, sort]);
  const cols = useMemo(() => {
    const keys = [...BASE_COLS, ...conds.map((c) => c.field), ...TAIL_COLS];
    return keys.filter((k, i) => keys.indexOf(k) === i);
  }, [conds]);

  function add(field: string, op?: Op, a?: number) {
    const f = FIELD_MAP[field];
    if (!f) return;
    setConds((cs) => [...cs, { id: newId(), field, op: op ?? (f.format === "bool" ? "is" : "ge"), a }]);
    setLimit(PAGE);
  }

  function exportCsv() {
    const header = ["代號", "名稱", "市場", ...cols.map((k) => FIELD_MAP[k]?.label ?? k)];
    const lines = sorted.map((r) => [
      r.code, r.name, r.market === "TWSE" ? "上市" : "上櫃",
      ...cols.map((k) => (FIELD_MAP[k].format === "yi" && typeof r[k] === "number" ? (r[k] as number) / 1e8 : r[k]) ?? ""),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `選股結果_${snap?.meta.asof ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const late = snap && isLate(snap.meta.asof);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-4">
      {/* 資料狀態 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <h1 className="text-xl font-bold text-ink">自訂篩選</h1>
        {snap && (
          <span className={`num rounded-md px-2 py-0.5 ${late ? "bg-warn-bg text-warn-ink" : "text-muted"}`}>
            資料日期：{snap.meta.asof.replaceAll("-", "/")}
            {late && "（今日資料尚未更新，可能休市或資料延遲）"}
          </span>
        )}
        {snap && !snap.meta.fin_complete && (
          <span className="rounded-md bg-warn-bg px-2 py-0.5 text-warn-ink">財報資料補齊中，基本面條件的結果可能不完整</span>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-up/40 bg-surface p-4 text-sm text-up">無法載入資料：{error}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* 左：條件 */}
        <aside className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Seg label="類型" value={universe} onChange={(v) => { setUniverse(v); setLimit(PAGE); }}
              options={[["all", "全部"], ["stock", "股票"], ["etf", "ETF"]]} />
            <Seg label="市場" value={market} onChange={(v) => { setMarket(v); setLimit(PAGE); }}
              options={[["all", "上市＋上櫃"], ["TWSE", "上市"], ["TPEX", "上櫃"]]} />
          </div>
          <p className="num text-sm text-muted">起始股票池：{pool.length.toLocaleString()} 檔</p>

          <ol className="space-y-2">
            {conds.map((c) => (
              <ConditionRow
                key={c.id} c={c} step={stepMap[c.id]} total={pool.length}
                onChange={(n) => setConds((cs) => cs.map((x) => (x.id === c.id ? n : x)))}
                onRemove={() => setConds((cs) => cs.filter((x) => x.id !== c.id))}
              />
            ))}
          </ol>

          <div className="rounded-lg border border-dashed border-line p-3">
            <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="add-field">新增條件</label>
            <div id="add-field">
              <FieldSelect value={adding} placeholder="選擇指標…" onChange={(k) => { if (k) add(k); setAdding(""); }} />
            </div>
            {conds.length === 0 && (
              <div className="mt-3">
                <p className="mb-2 text-xs text-muted">或從常用條件開始：</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map((q) => (
                    <button key={q.label} type="button" onClick={() => add(q.field, q.op, q.a)}
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:border-accent hover:text-accent">
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {conds.length > 0 && (
            <button type="button" onClick={() => setConds([])} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
              清除所有條件
            </button>
          )}
        </aside>

        {/* 右：結果 */}
        <section aria-live="polite">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink">
              {snap ? <>符合條件 <b className="num text-base">{result.length.toLocaleString()}</b> 檔</> : "載入中…"}
            </p>
            <label className="ml-auto flex items-center gap-1.5 text-sm text-muted lg:hidden">
              排序
              <select
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => { const [key, d] = e.target.value.split(":"); setSort({ key, dir: d === "1" ? 1 : -1 }); }}
                className="rounded-md border border-line bg-surface px-1.5 py-1 text-ink"
              >
                {cols.flatMap((k) => [
                  <option key={k + "-1"} value={`${k}:-1`}>{FIELD_MAP[k].label} 高→低</option>,
                  <option key={k + "1"} value={`${k}:1`}>{FIELD_MAP[k].label} 低→高</option>,
                ])}
              </select>
            </label>
            <button type="button" onClick={exportCsv} disabled={!result.length}
              className="rounded-md border border-line px-2.5 py-1 text-sm text-ink hover:border-accent disabled:opacity-40 lg:ml-auto">
              下載 CSV
            </button>
          </div>

          {snap && result.length === 0 && conds.length > 0 && (
            <EmptyHint steps={steps} conds={conds} />
          )}

          {/* 電腦版：表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface lg:block">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <Th label="代號／名稱" k="code" sort={sort} setSort={setSort} left />
                  {cols.map((k) => <Th key={k} label={FIELD_MAP[k].label} k={k} sort={sort} setSort={setSort} />)}
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

          {/* 手機版：卡片 */}
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
                      <dt className="truncate text-muted">{FIELD_MAP[k].label}</dt>
                      <dd className="num text-ink">{fmtUnit(r[k], FIELD_MAP[k].format, isSigned(k))}</dd>
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
      </div>
    </div>
  );
}

function toneClass(v: unknown) {
  const t = tone(v);
  return t === "up" ? "text-up" : t === "down" ? "text-down" : "text-muted";
}

function Th({ label, k, sort, setSort, left }: {
  label: string; k: string; sort: { key: string; dir: 1 | -1 };
  setSort: (s: { key: string; dir: 1 | -1 }) => void; left?: boolean;
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
  const f = FIELD_MAP[k];
  const colored = isSigned(k);
  return (
    <td className={`num whitespace-nowrap px-3 py-2 text-right ${colored ? toneClass(r[k]) : "text-ink"}`}>
      {fmt(r[k], f.format, colored)}
    </td>
  );
}

function EmptyHint({ steps, conds }: { steps: { id: string; alone: number }[]; conds: Condition[] }) {
  const tightest = steps.reduce((m, s) => (s.alone < m.alone ? s : m), steps[0]);
  const c = conds.find((x) => x.id === tightest?.id);
  return (
    <div className="mb-3 rounded-lg border border-line bg-surface p-4 text-sm text-ink">
      沒有同時符合所有條件的股票。
      {c && <>最嚴格的是「{FIELD_MAP[c.field].label}」（單獨只有 {tightest.alone} 檔符合），可以先放寬它。</>}
    </div>
  );
}

/** 依台灣時間推算「應該要有」的最新資料日（平日 18:00 後算當天），比它舊就提醒。 */
function isLate(asof: string): boolean {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const d = new Date(now);
  if (now.getHours() < 18) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return asof < expected;
}
