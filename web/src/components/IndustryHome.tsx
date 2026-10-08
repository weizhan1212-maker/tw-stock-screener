"use client";

import Link from "next/link";
import { useUrlState } from "@/hooks/useUrlState";
import { useMemo, useState } from "react";
import DataStatus from "@/components/DataStatus";
import { Seg } from "@/components/Screener";
import Treemap from "@/components/Treemap";
import { useSnapshot } from "@/hooks/useSnapshot";
import { industryStats, type IndustryStat, type Period, PERIODS, SCALE } from "@/lib/industry";
import { fmt, type Market } from "@/lib/screener";

const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null) => (v == null || Math.abs(v) < 0.005 ? "text-muted" : v > 0 ? "text-up" : "text-down");

type Key = "name" | "n" | "cap" | "ret" | "rs20" | "rs60" | "upRatio" | "inst5" | "pe" | "revUp";
const COLS: [Key, string][] = [
  ["n", "檔數"], ["cap", "市值（億）"], ["ret", "漲跌幅"], ["rs20", "20 日相對強度"], ["rs60", "60 日相對強度"],
  ["upRatio", "今日上漲比例"], ["inst5", "法人 5 日（億，估算）"], ["pe", "本益比中位數"], ["revUp", "營收年增家數比例"],
];

function val(s: IndustryStat, k: Key, period: Period): number | string | null {
  switch (k) {
    case "name": return s.name;
    case "ret": return s.ret[period];
    case "pe": return s.pe.med;
    default: return s[k];
  }
}

export default function IndustryHome() {
  const { snap, error } = useSnapshot();
  const [period, setPeriod] = useUrlState<Period>("p", "chg_pct", ["chg_pct", "ret5", "ret20", "ret60"]);
  const [market, setMarket] = useUrlState<Market>("m", "all", ["all", "TWSE", "TPEX"] as Market[]);
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "ret", dir: -1 });
  const stats = useMemo(
    () => (snap ? industryStats(snap.rows.filter((r) => market === "all" || r.market === market)) : []),
    [snap, market],
  );
  const sorted = useMemo(() => [...stats].sort((a, b) => {
    const x = val(a, sort.k, period), y = val(b, sort.k, period);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y as string, "zh-TW") : (x as number) - (y as number)) * sort.dir;
  }), [stats, sort, period]);
  const items = stats.map((s) => ({
    key: s.name, label: s.name, sub: `${s.n} 檔`, value: s.cap, change: s.ret[period], href: `/industry/${encodeURIComponent(s.name)}`,
  }));

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink">產業</h1>
        <DataStatus snap={snap} error={error} />
      </div>
      <p className="mt-2 text-sm text-muted">格子大小＝產業總市值，顏色＝市值加權漲跌幅（紅漲綠跌）。點格子看產業內個股。只計普通股，不含 ETF。</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Seg label="期間" value={period} onChange={setPeriod} options={PERIODS} />
        <Seg label="市場" value={market} onChange={setMarket} options={[["all", "上市＋上櫃"], ["TWSE", "上市"], ["TPEX", "上櫃"]]} />
      </div>

      <div className="mt-3">
        {snap ? <Treemap items={items} scale={SCALE[period]} fmt={pct} /> : <p className="text-sm text-muted">載入中…</p>}
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <Th k="name" label="產業" sort={sort} setSort={setSort} left />
              {COLS.map(([k, l]) => <Th key={k} k={k} label={k === "ret" ? `${PERIODS.find((p) => p[0] === period)![1]}漲跌幅` : l} sort={sort} setSort={setSort} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.name} className="border-t border-line hover:bg-surface-2">
                <td className="px-3 py-2"><Link href={`/industry/${encodeURIComponent(s.name)}`} className="text-ink hover:text-accent hover:underline">{s.name}</Link></td>
                <td className="num px-3 py-2 text-right text-ink">{s.n}</td>
                <td className="num px-3 py-2 text-right text-ink">{fmt(s.cap, "yiRaw")}</td>
                <td className={`num px-3 py-2 text-right ${tone(s.ret[period])}`}>{pct(s.ret[period])}</td>
                <td className={`num px-3 py-2 text-right ${tone(s.rs20)}`}>{pct(s.rs20)}</td>
                <td className={`num px-3 py-2 text-right ${tone(s.rs60)}`}>{pct(s.rs60)}</td>
                <td className="num px-3 py-2 text-right text-ink">{s.upRatio == null ? "—" : `${Math.round(s.upRatio)}%`}</td>
                <td className={`num px-3 py-2 text-right ${tone(s.inst5)}`}>{`${s.inst5 > 0 ? "+" : ""}${s.inst5.toFixed(1)}`}</td>
                <td className="num px-3 py-2 text-right text-ink">{s.pe.med == null ? "—" : s.pe.med.toFixed(1)}</td>
                <td className="num px-3 py-2 text-right text-ink">{s.revUp == null ? "—" : `${Math.round(s.revUp)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">相對強度＝產業市值加權漲幅 − 加權指數同期漲幅。法人金額以買賣超張數 × 收盤價估算。</p>
    </div>
  );
}

function Th({ k, label, sort, setSort, left }: {
  k: Key; label: string; sort: { k: Key; dir: 1 | -1 }; setSort: (s: { k: Key; dir: 1 | -1 }) => void; left?: boolean;
}) {
  const on = sort.k === k;
  return (
    <th className={`px-3 py-2 font-medium ${left ? "text-left" : "text-right"}`} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort({ k, dir: on ? (sort.dir === 1 ? -1 : 1) : k === "name" ? 1 : -1 })} className="hover:text-ink">
        {label}{on ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}
