"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FIELD_MAP, FIELDS, GROUPS, QUICK, UNIT, type Field } from "@/lib/fields";
import { type Condition, decodeConds, encodeConds, funnel, inUniverse, type Market, type Op, type Universe } from "@/lib/screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import DataStatus from "@/components/DataStatus";
import SavedScreens from "@/components/SavedScreens";
import Results, { type Sort } from "@/components/Results";

const BASE_COLS = ["close", "chg_pct", "volume_lots", "value", "market_cap"];
const TAIL_COLS = ["pe", "dividend_yield"];
let seq = 0;
const newId = () => `c${Date.now().toString(36)}${seq++}`;

// ---------- 小元件 ----------

export function Help({ field }: { field: Field }) {
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

export function NumInput({ value, onChange, label }: { value?: number; onChange: (v?: number) => void; label: string }) {
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

export function Seg<T extends string>({ value, options, onChange, label }: {
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
  const { snap, error } = useSnapshot();
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
  const [sort, setSort] = useState<Sort>(() => {
    const [key, d] = (params.get("s") ?? "").split(":");
    return FIELD_MAP[key] || key === "code" ? { key, dir: d === "asc" ? 1 : -1 } : { key: "market_cap", dir: -1 };
  });
  const [adding, setAdding] = useState("");
  const [extra, setExtra] = useState<string[]>(() => (params.get("x") ?? "").split(",").filter((k) => FIELD_MAP[k]));
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (extra.length) q.set("x", extra.join(","));
    if (conds.length) q.set("c", encodeConds(conds));
    if (universe !== "all") q.set("u", universe);
    if (market !== "all") q.set("m", market);
    q.set("s", `${sort.key}:${sort.dir === 1 ? "asc" : "desc"}`);
    return q.toString();
  }, [conds, universe, market, sort, extra]);
  useEffect(() => { window.history.replaceState(null, "", `?${query}`); }, [query]);

  function applyQuery(qs: string) {
    const q = new URLSearchParams(qs);
    setConds(decodeConds(q.get("c")));
    const u = q.get("u"), m = q.get("m");
    setUniverse(u === "stock" || u === "etf" ? u : "all");
    setMarket(m === "TWSE" || m === "TPEX" ? m : "all");
    const [key, d] = (q.get("s") ?? "").split(":");
    setSort(FIELD_MAP[key] || key === "code" ? { key, dir: d === "asc" ? 1 : -1 } : { key: "market_cap", dir: -1 });
    setExtra((q.get("x") ?? "").split(",").filter((k) => FIELD_MAP[k]));
  }

  const pool = useMemo(() => (snap ? snap.rows.filter((r) => inUniverse(r, universe, market)) : []), [snap, universe, market]);
  const { result, steps } = useMemo(() => funnel(pool, conds), [pool, conds]);
  const stepMap = Object.fromEntries(steps.map((s) => [s.id, s]));
  const cols = useMemo(() => {
    const keys = [...BASE_COLS, ...conds.map((c) => c.field), ...extra, ...TAIL_COLS];
    return keys.filter((k, i) => keys.indexOf(k) === i);
  }, [conds, extra]);

  function add(field: string, op?: Op, a?: number) {
    const f = FIELD_MAP[field];
    if (!f) return;
    setConds((cs) => [...cs, { id: newId(), field, op: op ?? (f.format === "bool" ? "is" : "ge"), a }]);
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink">自訂篩選</h1>
        <DataStatus snap={snap} error={error} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Seg label="類型" value={universe} onChange={setUniverse}
              options={[["all", "全部"], ["stock", "股票"], ["etf", "ETF"]]} />
            <Seg label="市場" value={market} onChange={setMarket}
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
          <div className="rounded-lg border border-line bg-surface p-3">
            <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="add-col">結果表額外欄位</label>
            <div id="add-col">
              <FieldSelect value="" placeholder="加一個欄位…" onChange={(k) => { if (k && !extra.includes(k)) setExtra((x) => [...x, k]); }} />
            </div>
            {extra.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {extra.map((k) => (
                  <button key={k} type="button" onClick={() => setExtra((x) => x.filter((y) => y !== k))}
                    aria-label={`移除欄位：${FIELD_MAP[k].label}`}
                    className="rounded-full border border-line px-2 py-0.5 text-xs text-ink hover:border-up hover:text-up">
                    {FIELD_MAP[k].label} ×
                  </button>
                ))}
              </div>
            )}
          </div>
          <SavedScreens currentQuery={query} onLoad={applyQuery} />
          {conds.length > 0 && (
            <button type="button" onClick={() => setConds([])} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
              清除所有條件
            </button>
          )}
        </aside>

        <Results
          key={`${universe}-${market}-${encodeConds(conds)}`}
          rows={result} cols={cols} sort={sort} setSort={setSort} loading={!snap}
          csvName={`選股結果_${snap?.meta.asof ?? ""}`}
          empty={conds.length > 0 ? <EmptyHint steps={steps} conds={conds} /> : null}
        />
      </div>
    </div>
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
