"use client";

import { useMemo, useState } from "react";
import DataStatus from "@/components/DataStatus";
import Results, { type Sort } from "@/components/Results";
import { Seg } from "@/components/Screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import { useUrlState } from "@/hooks/useUrlState";
import { type Market, num } from "@/lib/screener";

const COLS = ["close", "chg_pct", "etf_aum", "holders", "dividend_yield", "etf_div_count", "ret240", "avg_value20"];

export default function EtfHome() {
  const { snap, error } = useSnapshot();
  const [market, setMarket] = useUrlState<Market>("m", "all", ["all", "TWSE", "TPEX"] as Market[]);
  const [type, setType] = useUrlState<string>("t", "全部");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "etf_aum", dir: -1 });
  const etfs = useMemo(() => (snap ? snap.rows.filter((r) => r.sec_type === "etf" && r.stale !== 1) : []), [snap]);
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of etfs) if (r.etf_type) m.set(r.etf_type as string, (m.get(r.etf_type as string) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [etfs]);
  const rows = etfs.filter((r) => (market === "all" || r.market === market)
    && (type === "全部" || r.etf_type === type)
    && (!q || `${r.code}${r.name}${r.etf_index ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const total = rows.reduce((a, r) => a + (num(r.etf_aum) ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink">ETF</h1>
        <DataStatus snap={snap} error={error} />
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        規模＝發行單位數 × 收盤價（估算，只有上市 ETF）；殖利率＝近 12 個月配息 ÷ 收盤價；受益人數來自集保結算所（每週）。
        折溢價與持股明細沒有可合法自動取得的開放資料，請到各投信官網查詢。
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Seg label="市場" value={market} onChange={setMarket} options={[["all", "上市＋上櫃"], ["TWSE", "上市"], ["TPEX", "上櫃"]]} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="ETF 類型"
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink">
          <option>全部</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋代號、名稱、追蹤指數" aria-label="搜尋 ETF"
          className="w-56 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink" />
        {total > 0 && <span className="num text-sm text-muted">合計規模約 {Math.round(total).toLocaleString()} 億</span>}
      </div>
      <div className="mt-3">
        <Results rows={rows} cols={COLS} sort={sort} setSort={setSort} loading={!snap} countLabel="ETF"
          csvName={`ETF_${snap?.meta.asof ?? ""}`}
          badge={(r) => (r.etf_type || r.etf_index) ? (
            <span className="text-xs text-muted">{[r.etf_type, r.etf_index].filter(Boolean).join("・")}</span>
          ) : null} />
      </div>
    </div>
  );
}
