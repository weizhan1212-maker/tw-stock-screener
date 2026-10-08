"use client";

import Link from "next/link";
import BackLink from "@/components/BackLink";
import { useUrlState } from "@/hooks/useUrlState";
import { useEffect, useMemo, useState } from "react";
import DataStatus from "@/components/DataStatus";
import Results, { type Sort } from "@/components/Results";
import { Seg } from "@/components/Screener";
import Treemap from "@/components/Treemap";
import { useSnapshot } from "@/hooks/useSnapshot";
import { groupIndustries, industryNotes, type Period, PERIODS, SCALE, statOf } from "@/lib/industry";
import { num, type Row } from "@/lib/screener";

const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null) => (v == null || Math.abs(v) < 0.005 ? "text-ink" : v > 0 ? "text-up" : "text-down");
const COLS = ["close", "chg_pct", "ret20", "rs60", "pe", "pb", "rev_yoy", "inst_amt5", "market_cap"];

export default function IndustryPage({ name }: { name: string }) {
  const { snap, error } = useSnapshot();
  const [period, setPeriod] = useUrlState<Period>("p", "chg_pct", ["chg_pct", "ret5", "ret20", "ret60"]);
  const [sort, setSort] = useState<Sort>({ key: "market_cap", dir: -1 });
  useEffect(() => { document.title = `${name}｜產業｜股見未來`; }, [name]);
  const rows = useMemo<Row[]>(() => (snap ? groupIndustries(snap.rows).get(name) ?? [] : []), [snap, name]);
  const s = useMemo(() => (rows.length ? statOf(name, rows) : null), [rows, name]);
  const notes = s ? industryNotes(s) : [];
  const byRet = [...rows].filter((r) => num(r.ret20) != null).sort((a, b) => (num(b.ret20) as number) - (num(a.ret20) as number));
  const items = [...rows].sort((a, b) => (num(b.market_cap) ?? 0) - (num(a.market_cap) ?? 0)).slice(0, 80).map((r) => ({
    key: r.code as string, label: r.name as string, sub: r.code as string, value: num(r.market_cap) ?? 0,
    change: num(r[period]), href: `/stock/${r.code}`,
  }));

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <nav className="mb-2 text-sm"><BackLink fallback="/industry" fallbackLabel="產業" /></nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold text-ink">{name}</h1>
        <DataStatus snap={snap} error={error} />
      </div>

      {snap && !s && <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink">找不到這個產業的股票。</p>}

      {s && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <Metric label="檔數／總市值" value={`${s.n} 檔／${Math.round(s.cap).toLocaleString()} 億`} />
            <Metric label="今日漲跌（市值加權）" value={pct(s.ret.chg_pct)} cls={tone(s.ret.chg_pct)} />
            <Metric label="20 日相對強度" value={pct(s.rs20)} cls={tone(s.rs20)} hint="產業漲幅 − 大盤漲幅" />
            <Metric label="60 日相對強度" value={pct(s.rs60)} cls={tone(s.rs60)} />
            <Metric label="法人 5／20 日（億，估算）" value={`${s.inst5.toFixed(1)}／${s.inst20.toFixed(1)}`} cls={tone(s.inst5)} />
            <Metric label="站上季線比例" value={s.above60 == null ? "—" : `${Math.round(s.above60)}%`} />
            <Metric label="本益比區間（25%～75%）" value={s.pe.p25 == null ? "—" : `${s.pe.p25.toFixed(1)}～${s.pe.p75!.toFixed(1)} 倍`} hint={s.pe.med == null ? undefined : `中位數 ${s.pe.med.toFixed(1)} 倍`} />
            <Metric label="股價淨值比中位數" value={s.pb == null ? "—" : `${s.pb.toFixed(2)} 倍`} />
            <Metric label="營收年增家數比例" value={s.revUp == null ? "—" : `${Math.round(s.revUp)}%`} hint={s.revMed == null ? undefined : `年增率中位數 ${pct(s.revMed)}`} />
            <Metric label="今日上漲比例" value={s.upRatio == null ? "—" : `${Math.round(s.upRatio)}%`} />
          </dl>

          {notes.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink">
              {notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Movers title="近 20 日領漲" rows={byRet.slice(0, 5)} />
            <Movers title="近 20 日落後" rows={byRet.slice(-5).reverse()} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-bold text-ink">個股熱力圖</h2>
            <Seg label="期間" value={period} onChange={setPeriod} options={PERIODS} />
            {rows.length > 80 && <span className="text-xs text-muted">只顯示市值前 80 檔</span>}
          </div>
          <div className="mt-2"><Treemap items={items} scale={SCALE[period] * 1.5} fmt={pct} /></div>

          <div className="mt-6">
            <Results rows={rows} cols={COLS} sort={sort} setSort={setSort} csvName={`${name}_${snap?.meta.asof ?? ""}`} />
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, cls = "text-ink", hint }: { label: string; value: string; cls?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num mt-0.5 text-base font-bold ${cls}`}>{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function Movers({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <h3 className="border-b border-line bg-surface-2 px-3 py-2 text-sm font-bold text-ink">{title}</h3>
      <ol className="text-sm">
        {rows.map((r) => {
          const v = num(r.ret20);
          return (
            <li key={r.code as string} className="flex items-center gap-3 border-t border-line px-3 py-2 first:border-t-0">
              <span className="num w-12 text-muted">{r.code as string}</span>
              <Link href={`/stock/${r.code}`} className="min-w-0 flex-1 truncate text-ink hover:text-accent hover:underline">{r.name as string}</Link>
              <span className={`num ${tone(v)}`}>{pct(v)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
