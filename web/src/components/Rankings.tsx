"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import DataStatus from "@/components/DataStatus";
import Results, { type Sort } from "@/components/Results";
import { Seg } from "@/components/Screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import { inUniverse, type Market, num, type Row, type Universe } from "@/lib/screener";

const TOP = 100;

interface Rank {
  id: string; label: string; key: string; dir: 1 | -1; cols: string[];
  /** 額外門檻（例如成交量太小的不列入） */
  keep?: (r: Row) => boolean; note?: string;
}

const pos = (k: string) => (r: Row) => (num(r[k]) ?? 0) > 0;
const neg = (k: string) => (r: Row) => (num(r[k]) ?? 0) < 0;
const liquid = (lots: number) => (r: Row) => (num(r.volume_lots) ?? 0) >= lots;
const BASE = ["close", "chg_pct"];
const inr = (r: Row, k: string, lo: number, hi: number) => { const v = num(r[k]); return v != null && v >= lo && v <= hi; };

const GROUPS: { id: string; label: string; ranks: Rank[] }[] = [
  { id: "hot", label: "熱門", ranks: [
    { id: "value", label: "成交金額", key: "value", dir: -1, cols: [...BASE, "value", "volume_lots"] },
    { id: "volume", label: "成交量", key: "volume_lots", dir: -1, cols: [...BASE, "volume_lots", "value"] },
    { id: "gainers", label: "漲幅", key: "chg_pct", dir: -1, cols: [...BASE, "volume_lots", "value"], keep: liquid(100), note: "成交量 100 張以上" },
    { id: "losers", label: "跌幅", key: "chg_pct", dir: 1, cols: [...BASE, "volume_lots", "value"], keep: liquid(100), note: "成交量 100 張以上" },
    { id: "volratio", label: "爆量", key: "vol_ratio", dir: -1, cols: [...BASE, "vol_ratio", "volume_lots"], keep: liquid(500), note: "成交量 500 張以上；量比 = 今日量 ÷ 20 日均量" },
  ] },
  { id: "insti", label: "法人", ranks: [
    { id: "total_buy", label: "三大法人買超", key: "total_value", dir: -1, cols: [...BASE, "total_value", "total_net", "foreign_value", "trust_value"], keep: pos("total_value") },
    { id: "total_sell", label: "三大法人賣超", key: "total_value", dir: 1, cols: [...BASE, "total_value", "total_net", "foreign_value", "trust_value"], keep: neg("total_value") },
    { id: "foreign_buy", label: "外資買超", key: "foreign_value", dir: -1, cols: [...BASE, "foreign_value", "foreign_net", "foreign_net5", "foreign_ratio"], keep: pos("foreign_value") },
    { id: "foreign_sell", label: "外資賣超", key: "foreign_value", dir: 1, cols: [...BASE, "foreign_value", "foreign_net", "foreign_net5", "foreign_ratio"], keep: neg("foreign_value") },
    { id: "trust_buy", label: "投信買超", key: "trust_value", dir: -1, cols: [...BASE, "trust_value", "trust_net", "trust_net5", "trust_buy_streak"], keep: pos("trust_value") },
    { id: "trust_sell", label: "投信賣超", key: "trust_value", dir: 1, cols: [...BASE, "trust_value", "trust_net", "trust_net5"], keep: neg("trust_value") },
    { id: "foreign_streak", label: "外資連買", key: "foreign_buy_streak", dir: -1, cols: [...BASE, "foreign_buy_streak", "foreign_net5", "foreign_net20"], keep: pos("foreign_buy_streak") },
    { id: "trust_streak", label: "投信連買", key: "trust_buy_streak", dir: -1, cols: [...BASE, "trust_buy_streak", "trust_net5", "trust_net20"], keep: pos("trust_buy_streak") },
  ] },
  { id: "daytrade", label: "當沖", ranks: [
    { id: "dt_ratio", label: "當沖比", key: "daytrade_ratio", dir: -1, cols: [...BASE, "daytrade_ratio", "daytrade_lots", "volume_lots"], keep: liquid(1000), note: "成交量 1,000 張以上" },
    { id: "dt_lots", label: "當沖量", key: "daytrade_lots", dir: -1, cols: [...BASE, "daytrade_lots", "daytrade_ratio", "volume_lots"] },
  ] },
  { id: "sbl", label: "借券", ranks: [
    { id: "sbl_sell", label: "借券賣出", key: "sbl_sell_lots", dir: -1, cols: [...BASE, "sbl_sell_lots", "sbl_balance_lots", "volume_lots"], keep: pos("sbl_sell_lots") },
    { id: "sbl_bal", label: "借券賣出餘額", key: "sbl_balance_lots", dir: -1, cols: [...BASE, "sbl_balance_lots", "sbl_sell_lots", "short_balance"], keep: pos("sbl_balance_lots") },
  ] },
  { id: "risk", label: "進階", ranks: [
    { id: "pullback", label: "突破後回踩", key: "dist_high60", dir: -1,
      cols: [...BASE, "dist_high60", "ret60", "ret20", "volume_lots"],
      keep: (r) => liquid(500)(r) && inr(r, "dist_high60", -10, -3) && (num(r.ret60) ?? 0) >= 10 && r.above_ma60 === 1,
      note: "近 60 日漲 10% 以上、仍在季線之上，但離 60 日高點回落 3～10%；成交量 500 張以上。依離高點由近到遠排序" },
    { id: "rs_calm", label: "相對強勢未過熱", key: "rs60", dir: -1,
      cols: [...BASE, "rs60", "rs20", "dist_high52", "dist_ma240"],
      keep: (r) => liquid(500)(r) && (num(r.rs60) ?? -1) > 0 && (num(r.dist_high52) ?? -99) >= -5 && (num(r.ret20) ?? 99) <= 15 && (num(r.dist_ma240) ?? 99) <= 40,
      note: "近 60 日強過大盤、離 52 週高點 5% 以內，但 20 日漲幅 ≤ 15%、離年線 ≤ 40%；成交量 500 張以上" },
    { id: "rev_value", label: "營收加速＋估值合理", key: "rev_yoy_chg", dir: -1,
      cols: [...BASE, "rev_yoy", "rev_yoy_chg", "pe", "peg"],
      keep: (r) => liquid(300)(r) && inr(r, "rev_yoy", 15, 300) && (num(r.rev_yoy_chg) ?? -99) > 0 && inr(r, "pe", 0.01, 20),
      note: "月營收年增 15～300%（排除低基期暴增）且比 3 個月前更高、本益比 20 倍以下；成交量 300 張以上" },
    { id: "inst_quiet", label: "法人連買但價格未漲", key: "inst_amt5", dir: -1,
      cols: [...BASE, "inst_amt5", "ret5", "ret20", "foreign_buy_streak", "trust_buy_streak"],
      keep: (r) => liquid(300)(r) && (num(r.inst_amt5) ?? 0) > 0 && ((num(r.foreign_buy_streak) ?? 0) >= 3 || (num(r.trust_buy_streak) ?? 0) >= 3)
        && (num(r.ret5) ?? 99) <= 2 && (num(r.ret20) ?? 99) <= 5,
      note: "外資或投信連買 3 天以上、5 日漲幅 ≤ 2%、20 日漲幅 ≤ 5%；金額為估算；成交量 300 張以上" },
  ] },
  { id: "block", label: "鉅額", ranks: [
    { id: "block", label: "鉅額交易", key: "block_value", dir: -1, cols: [...BASE, "block_value", "value", "volume_lots"], keep: pos("block_value") },
  ] },
];

/** 依排行條件取前 100 名；之後使用者點表頭可再自由排序。 */
function topRows(all: Row[], rank: Rank, universe: Universe, market: Market): Row[] {
  const k = rank.key;
  const pool = all.filter((r) => r.stale !== 1 && inUniverse(r, universe, market) && num(r[k]) != null && (!rank.keep || rank.keep(r)));
  return pool.sort((a, b) => ((num(a[k]) as number) - (num(b[k]) as number)) * rank.dir).slice(0, TOP);
}

type Dca = { code: string; name: string; accounts: number };

/** 定期定額交易戶數排行：證交所每月公布前 20 名（個股、ETF 各一）。 */
function DcaRank() {
  const [dca, setDca] = useState<{ stocks: Dca[]; etfs: Dca[] } | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/market").then((r) => (r.ok ? r.json() : null)).then((m) => setDca(m?.dca ?? null)).catch(() => setDca(null));
  }, []);
  if (dca === undefined) return <p className="text-sm text-muted">載入中…</p>;
  if (!dca) return <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">定期定額排行目前沒有資料（每天收盤後更新一次）。</p>;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {([["ETF", dca.etfs], ["個股", dca.stocks]] as const).map(([title, list]) => (
          <section key={title} className="overflow-hidden rounded-lg border border-line bg-surface">
            <h2 className="border-b border-line bg-surface-2 px-3 py-2 text-sm font-bold text-ink">{title}</h2>
            <ol className="text-sm">
              {list.map((x, i) => (
                <li key={x.code} className="flex items-center gap-3 border-t border-line px-3 py-2 first:border-t-0">
                  <span className="num w-5 text-right text-muted">{i + 1}</span>
                  <span className="num w-14 text-muted">{x.code}</span>
                  <Link href={`/stock/${x.code}`} className="min-w-0 flex-1 truncate text-ink hover:text-accent hover:underline">{x.name}</Link>
                  <span className="num text-ink">{x.accounts.toLocaleString()} 戶</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">資料來源：臺灣證券交易所「定期定額交易戶數統計排行」，每月更新；只含上市證券。</p>
    </>
  );
}

export default function Rankings() {
  const { snap, error } = useSnapshot();
  // 目前看的榜單記在網址（?g=&r=&u=&m=），點進個股再按返回會回到同一個榜
  const q = useSearchParams();
  const [gid, setGid] = useState(() => (q.get("g") === "dca" || GROUPS.some((g) => g.id === q.get("g")) ? q.get("g")! : "hot"));
  const group = GROUPS.find((g) => g.id === gid) ?? GROUPS[0];
  const [rid, setRid] = useState(() => group.ranks.find((r) => r.id === q.get("r"))?.id ?? group.ranks[0].id);
  const rank = group.ranks.find((r) => r.id === rid) ?? group.ranks[0];
  const [universe, setUniverse] = useState<Universe>(() => (["stock", "etf", "all"].includes(q.get("u") ?? "") ? q.get("u") as Universe : "stock"));
  const [market, setMarket] = useState<Market>(() => (["all", "TWSE", "TPEX"].includes(q.get("m") ?? "") ? q.get("m") as Market : "all"));
  const [sort, setSort] = useState<Sort>({ key: rank.key, dir: rank.dir });
  useEffect(() => {
    const p = new URLSearchParams({ g: gid, ...(gid === "dca" ? {} : { r: rank.id, u: universe, m: market }) });
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${p}`);
  }, [gid, rank.id, universe, market]);

  function pick(g: string, r?: string) {
    if (g === "dca") { setGid(g); return; }
    const grp = GROUPS.find((x) => x.id === g)!;
    const rk = grp.ranks.find((x) => x.id === r) ?? grp.ranks[0];
    setGid(g); setRid(rk.id); setSort({ key: rk.key, dir: rk.dir });
  }

  const rows = snap ? topRows(snap.rows, rank, universe, market) : [];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold text-ink">排行榜</h1>
        <DataStatus snap={snap} error={error} />
      </div>

      <div role="tablist" aria-label="排行分類" className="mt-4 flex gap-1 overflow-x-auto border-b border-line">
        {[...GROUPS, { id: "dca", label: "定期定額" }].map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={g.id === gid} onClick={() => pick(g.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${g.id === gid ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink"}`}>
            {g.label}
          </button>
        ))}
      </div>

      {gid === "dca" ? <div className="mt-4"><DcaRank /></div> : (<>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {group.ranks.map((r) => (
          <button key={r.id} type="button" aria-pressed={r.id === rank.id} onClick={() => pick(gid, r.id)}
            className={`rounded-full border px-3 py-1 text-sm ${r.id === rank.id ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink hover:border-accent"}`}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Seg label="類型" value={universe} onChange={setUniverse} options={[["stock", "股票"], ["etf", "ETF"], ["all", "全部"]]} />
        <Seg label="市場" value={market} onChange={setMarket} options={[["all", "上市＋上櫃"], ["TWSE", "上市"], ["TPEX", "上櫃"]]} />
        <span className="text-xs text-muted">前 {TOP} 名{rank.note && `・${rank.note}`}</span>
      </div>

      <div className="mt-4">
        <Results rows={rows} cols={rank.cols} sort={sort} setSort={setSort} csvName={`排行榜_${rank.label}_${snap?.meta.asof ?? ""}`}
          loading={!snap && !error} countLabel="共"
          empty={<p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">這個排行目前沒有資料（可能資料還在補齊中）。</p>} />
      </div>
      </>)}
    </div>
  );
}
