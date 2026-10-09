"use client";

/** 個股頁：報價、焦點標籤、K 線、多空、支撐壓力、財務健康、籌碼、營收、財報、股利、大戶。 */
import Link from "next/link";
import BackLink from "@/components/BackLink";
import { useEffect, useMemo, useState } from "react";
import AiSummaryCard from "@/components/AiSummary";
import DataStatus from "@/components/DataStatus";
import Section from "@/components/Section";
import { EtfInfoCard, EventStatsCard, HealthExplain, NoticesCard, RiskCard, ValuationCard } from "@/components/StockRisk";
import KChart from "@/components/KChart";
import LivePanel, { liveLabel } from "@/components/LivePanel";
import NewsList from "@/components/NewsList";
import WatchStar from "@/components/WatchStar";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useSnapshot } from "@/hooks/useSnapshot";
import { fmtMoney, num, type Row } from "@/lib/screener";
import {
  chipStamp, dailyBars, focusTags, grade, industryRank, outlooks, quarterStamp, revenueStamp, type StockFile, supportResistance,
} from "@/lib/stock";
import { defaults, makeCtx, STRATEGIES } from "@/lib/strategies";

const n = (v: unknown, d = 2) => {
  const x = num(v);
  return x == null ? "—" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const signed = (v: unknown, d = 2) => {
  const x = num(v);
  return x == null ? "—" : `${x > 0 ? "+" : ""}${n(x, d)}`;
};
const tone = (v: unknown) => {
  const x = num(v);
  return x == null || x === 0 ? "text-muted" : x > 0 ? "text-up" : "text-down";
};

function useStock(code: string) {
  const [data, setData] = useState<StockFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/stock/${code}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) setData(j as StockFile);
      })
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [code]);
  return { data, error };
}

export default function StockPage({ code }: { code: string }) {
  const { snap, error: snapErr } = useSnapshot();
  const { data, error } = useStock(code);
  const row: Row | undefined = useMemo(() => snap?.rows.find((r) => r.code === code), [snap, code]);
  const name = (row?.name as string) || data?.info.name || "";
  const isStock = (row?.sec_type ?? data?.info.sec_type) === "stock";
  // 盤中即時（富果，已核准成員都拿得到）；比盤後快照新或同一天才顯示
  const liveAll = useLiveQuotes([code], 10_000);
  const live = liveAll?.[code];
  // 盤後資料已經更新到同一天（傍晚以後）就不再顯示即時區塊，避免重複
  const showLive = !!live && live.price != null && (!snap || live.date > snap.meta.asof || (live.date === snap.meta.asof && !live.isClose));

  const tags = useMemo(() => (snap ? focusTags(snap.rows, code) : []), [snap, code]);
  const matched = useMemo(() => {
    if (!snap) return [];
    const ctx = makeCtx(snap.rows, snap.meta.market_bull);
    return STRATEGIES.filter((s) => s.run(ctx, defaults(s)).some((r) => r.code === code));
  }, [snap, code]);

  useEffect(() => {
    if (name) document.title = `${code} ${name}｜股見未來`;
  }, [code, name]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <nav className="mb-2 text-sm"><BackLink fallback="/" fallbackLabel="策略選股" /></nav>

      {/* 標頭：左邊名稱、價格上下對齊；右邊三個同樣大小的動作按鈕 */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="text-2xl font-bold text-ink">{name || code}</h1>
            <span className="num text-lg text-muted">{code}</span>
            {(row?.market ?? data?.info.market) && (
              <span className="self-center rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{(row?.market ?? data?.info.market) === "TPEX" ? "上櫃" : "上市"}</span>
            )}
            {!isStock && <span className="self-center rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">ETF</span>}
            {typeof row?.ind === "string" && row.ind && (
              <Link href={`/industry/${encodeURIComponent(row.ind)}`} className="self-center rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted hover:text-accent">
                {row.ind}
              </Link>
            )}
          </div>
          {showLive && live ? (
            <div className="num mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-3xl font-bold text-ink">{n(live.price, 2)}</span>
              <span className={`text-lg ${tone(live.change)}`}>{signed(live.change)}（{signed(live.pct)}%）</span>
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">{liveLabel(live)}</span>
            </div>
          ) : row && (
            <div className="num mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-3xl font-bold text-ink">{n(row.close, 2)}</span>
              {num(row.prev_close) != null && num(row.chg_pct) != null && (
                <span className={`text-lg ${tone(row.chg_pct)}`}>{signed(num(row.close)! - num(row.prev_close)!)}（{signed(row.chg_pct)}%）</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WatchStar code={code} name={name} size="md" />
          <Link href={`/compare?codes=${code}`} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:border-accent hover:text-ink">⇄ 比較</Link>
          <Link href={`/alerts?code=${code}`} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:border-accent hover:text-ink">🔔 警報</Link>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2"><DataStatus snap={snap} error={snapErr} /></div>

      {showLive && live && <LivePanel q={live} />}

      {showLive && snap && <p className="mt-4 text-xs text-muted">以下為 {snap.meta.asof.replaceAll("-", "/")} 盤後資料</p>}
      {row && (
        <dl className={`num ${showLive ? "mt-1" : "mt-4"} grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-4 lg:grid-cols-8`}>
          {[
            ["成交量", `${n(row.volume_lots, 0)} 張`],
            ["成交金額", fmtMoney(num(row.value) ?? 0)],
            ["量比", `${n(row.vol_ratio)} 倍`],
            ["市值", row.market_cap != null ? `${n(row.market_cap, 0)} 億` : "—"],
            ["本益比", n(row.pe)],
            ["股價淨值比", n(row.pb)],
            ["殖利率", row.dividend_yield != null ? `${n(row.dividend_yield)}%` : "—"],
            ["距 52 週高點", row.dist_high52 != null ? `${signed(row.dist_high52)}%` : "—"],
          ].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>
          ))}
        </dl>
      )}

      {/* 焦點與策略 */}
      {(tags.length > 0 || matched.length > 0) && (
        <div className="mt-3 space-y-2">
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">強勢焦點</span>
              {tags.slice(0, 10).map((t) => (
                <span key={t.label} className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  t.tone === "up" ? "border-up/40 text-up" : t.tone === "down" ? "border-down/40 text-down" : "border-line text-ink"}`}>
                  {t.label}第 {t.rank} 名
                </span>
              ))}
            </div>
          )}
          {matched.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">符合策略</span>
              {matched.map((s) => (
                <Link key={s.id} href={`/strategy/${s.id}`} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent hover:underline">
                  {s.author ? `${s.name}（${s.author}）` : s.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-up">個股資料載入失敗：{error}</p>}

      <div className="mt-4 space-y-4">
        {data ? <KChart s={data} /> : !error && <div className="h-[420px] animate-pulse rounded-lg border border-line bg-surface" />}

        {isStock && snap && <AiSummaryCard key={code} code={code} asof={snap.meta.asof} />}

        <div className="grid gap-4 lg:grid-cols-2">
          {row && <OutlookCard row={row} />}
          {data && <LevelsCard s={data} />}
        </div>

        {!isStock && row && <EtfInfoCard row={row} s={data} />}
        {data && <RiskCard s={data} row={row} />}
        {isStock && data && <NoticesCard s={data} />}
        {isStock && data && row && <ValuationCard s={data} row={row} />}
        {isStock && snap && row && <HealthCard rows={snap.rows} row={row} code={code} s={data} />}
        {data && <ChipsCard s={data} row={row} />}
        {data?.revenue && data.revenue.length > 0 && <RevenueCard s={data} />}
        {data?.quarters && data.quarters.length > 0 && <QuartersCard s={data} />}
        {data?.dividends && data.dividends.length > 0 && <DividendCard s={data} />}
        {data && <EventStatsCard s={data} />}
        {name && (
          <Section id="news" title="相關新聞" note="來源：Google 新聞，點標題到原網站閱讀">
            <NewsList q={`${name} ${code}`} fallback={name} limit={10} />
          </Section>
        )}
      </div>
    </div>
  );
}

// ---------------- 短中長線 ----------------

function OutlookCard({ row }: { row: Row }) {
  const items = outlooks(row);
  return (
    <Section id="outlook" title="技術面狀態" note="依均線、漲跌、KD、MACD 逐項檢查，非買賣建議">
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((o) => (
          <div key={o.label} className="rounded-md bg-surface-2 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink">{o.label}<span className="ml-1 text-xs text-muted">{o.span}</span></span>
              <span className={`text-sm font-bold ${o.state === "偏多" ? "text-up" : o.state === "偏空" ? "text-down" : "text-muted"}`}>{o.state}</span>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {o.checks.map((c) => (
                <li key={c.label} className="flex gap-1.5">
                  <span aria-hidden className={c.ok == null ? "text-muted" : c.ok ? "text-up" : "text-down"}>{c.ok == null ? "－" : c.ok ? "✓" : "✗"}</span>
                  <span className={c.ok == null ? "text-muted" : "text-ink"}>
                    {c.label}<span className="sr-only">：{c.ok == null ? "資料不足" : c.ok ? "是" : "否"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------- 支撐壓力 ----------------

function LevelsCard({ s }: { s: StockFile }) {
  const lv = useMemo(() => supportResistance(dailyBars(s, true)), [s]);
  const zone = (z: { lo: number; hi: number }) => (Math.abs(z.hi - z.lo) / z.lo < 0.002 ? n(z.lo) : `${n(z.lo)}～${n(z.hi)}`);
  const dist = (x: number) => `${signed(((x / lv.price) - 1) * 100, 1)}%`;
  return (
    <Section id="levels" title="支撐與壓力" note="近 120 個交易日的轉折價位聚集區（還原價）">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md bg-surface-2 p-3">
          <div className="text-xs text-muted">上方壓力</div>
          {lv.resistances.length ? lv.resistances.map((z, i) => (
            <div key={i} className="num mt-1 flex justify-between gap-2">
              <span className="text-ink">{zone(z)}</span><span className="text-xs text-muted">{dist(z.lo)}・{z.touches} 次</span>
            </div>
          )) : <div className="mt-1 text-ink">{lv.newHigh ? "接近近期新高，上方沒有壓力區" : "—"}</div>}
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          <div className="text-xs text-muted">下方支撐</div>
          {lv.supports.length ? lv.supports.map((z, i) => (
            <div key={i} className="num mt-1 flex justify-between gap-2">
              <span className="text-ink">{zone(z)}</span><span className="text-xs text-muted">{dist(z.hi)}・{z.touches} 次</span>
            </div>
          )) : <div className="mt-1 text-ink">—</div>}
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        「次」是過去這個價位附近出現高點或低點的次數，次數越多，越多人會在這附近交易。這是歷史資料整理，不代表價格一定會在這裡止跌或遇壓。
      </p>
    </Section>
  );
}

// ---------------- 財務健康 ----------------

function HealthCard({ rows, row, code, s }: { rows: Row[]; row: Row; code: string; s: StockFile | null }) {
  const score = num(row.health_score);
  const ir = industryRank(rows, code);
  const parts: [string, string, unknown][] = [
    ["盈利能力", "ROE、ROA、毛利率、營業利益率", row.hs_profit],
    ["流動性", "流動比率、自由現金流", row.hs_liquid],
    ["財務結構", "負債比", row.hs_struct],
    ["營運效率", "資產周轉率、F-Score", row.hs_eff],
    ["成長性", "營收與 EPS 成長", row.hs_growth],
  ];
  return (
    <Section id="health" title="財務健康評級" note="各項以全市場普通股百分位計分（0–100）">
      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex flex-col items-start justify-center rounded-md bg-surface-2 p-4">
          <span className="text-4xl font-bold text-ink">{grade(score)}</span>
          <span className="num mt-1 text-sm text-muted">健康度 {score == null ? "—" : Math.round(score)} 分</span>
          {ir && <span className="num mt-1 text-xs text-muted">{row.ind as string} 第 {ir.rank} / {ir.total} 名</span>}
        </div>
        <ul className="space-y-2.5">
          {parts.map(([label, hint, v]) => {
            const x = num(v);
            return (
              <li key={label}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{label}<span className="ml-1.5 text-xs text-muted">{hint}</span></span>
                  <span className="num text-ink">{x == null ? "不適用" : Math.round(x)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${x ?? 0}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {[
          ["近四季 EPS", n(row.eps_ttm)], ["ROE", row.roe != null ? `${n(row.roe)}%` : "—"],
          ["毛利率", row.gross_margin != null ? `${n(row.gross_margin)}%` : "—"], ["負債比", row.debt_ratio != null ? `${n(row.debt_ratio)}%` : "—"],
          ["流動比率", n(row.current_ratio)], ["自由現金流", row.fcf_ttm != null ? `${n((num(row.fcf_ttm) ?? 0) / 1e8)} 億` : "—"],
          ["F-Score", n(row.f_score, 0)], ["連續配息", row.div_years != null ? `${n(row.div_years, 0)} 年` : "—"],
        ].map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>
        ))}
      </dl>
      <HealthExplain rows={rows} row={row} s={s} />
    </Section>
  );
}

// ---------------- 籌碼 ----------------

function ChipsCard({ s, row }: { s: StockFile; row?: Row }) {
  const d = s.daily;
  const last = d.d.length - 1;
  const idx = Array.from({ length: Math.min(10, d.d.length) }, (_, k) => last - k);
  const sum = (arr: (number | null)[], k: number) => arr.slice(-k).reduce<number>((a, b) => a + (b ?? 0), 0);
  const h = s.holders ?? [];
  const hl = h[h.length - 1], hp = h[h.length - 2];
  return (
    <Section id="chips" title="籌碼" note="單位：張" stamp={chipStamp(s, s.asof)}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[520px] text-sm">
            <thead className="text-xs text-muted">
              <tr className="text-right">
                <th scope="col" className="py-1.5 text-left font-medium">日期</th>
                <th scope="col" className="font-medium">外資</th><th scope="col" className="font-medium">投信</th>
                <th scope="col" className="font-medium">自營商</th><th scope="col" className="font-medium">融資餘額</th>
                <th scope="col" className="font-medium">融券餘額</th>
              </tr>
            </thead>
            <tbody>
              {idx.map((i) => (
                <tr key={d.d[i]} className="border-t border-line text-right">
                  <td className="py-1.5 text-left text-muted">{d.d[i].slice(5).replace("-", "/")}</td>
                  <td className={tone(d.fi[i])}>{signed(d.fi[i], 0)}</td>
                  <td className={tone(d.it[i])}>{signed(d.it[i], 0)}</td>
                  <td className={tone(d.dl[i])}>{signed(d.dl[i], 0)}</td>
                  <td className="text-ink">{n(d.mb[i], 0)}</td>
                  <td className="text-ink">{n(d.sb[i], 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="num space-y-2 rounded-md bg-surface-2 p-3 text-sm">
          {[
            ["外資近 5 日", sum(d.fi, 5)], ["外資近 20 日", sum(d.fi, 20)],
            ["投信近 5 日", sum(d.it, 5)], ["投信近 20 日", sum(d.it, 20)],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className={tone(v)}>{signed(v, 0)}</dd></div>
          ))}
          {row?.foreign_ratio != null && (
            <div className="flex justify-between"><dt className="text-muted">外資持股比</dt><dd className="text-ink">{n(row.foreign_ratio)}%</dd></div>
          )}
          <div className="border-t border-line pt-2">
            <div className="flex justify-between"><dt className="text-muted">千張大戶持股</dt>
              <dd className="text-ink">{hl?.big != null ? `${n(hl.big)}%` : "—"}
                {hl?.big != null && hp?.big != null && <span className={`ml-1 text-xs ${tone(hl.big - hp.big)}`}>{signed(hl.big - hp.big)}</span>}
              </dd>
            </div>
            <div className="mt-2 flex justify-between"><dt className="text-muted">10 張以下散戶</dt><dd className="text-ink">{hl?.retail != null ? `${n(hl.retail)}%` : "—"}</dd></div>
            <p className="mt-1.5 text-xs text-muted">{hl ? `集保資料 ${hl.d.replaceAll("-", "/")}，每週五更新` : "集保大戶資料從上線起每週累積"}</p>
          </div>
        </dl>
      </div>
    </Section>
  );
}

// ---------------- 營收 ----------------

function RevenueCard({ s }: { s: StockFile }) {
  const rev = s.revenue ?? [];
  const map = new Map(rev.map(([m, v]) => [m, v]));
  const last = rev.slice(-24);
  const yoy = (m: string, v: number | null) => {
    const [y, mm] = m.split("-");
    const ly = map.get(`${Number(y) - 1}-${mm}`);
    return v != null && ly ? ((v / ly) - 1) * 100 : null;
  };
  const max = Math.max(...last.map(([, v]) => v ?? 0), 1);
  const [hover, setHover] = useState<number | null>(null);
  const hi = hover ?? last.length - 1;
  const [hm, hv] = last[hi] ?? ["", null];
  return (
    <Section id="revenue" title="月營收" note="近 24 個月，單位：億元" stamp={revenueStamp(s)}>
      <p className="num mb-2 text-sm text-ink">
        {hm} 營收 <b>{hv != null ? n(hv / 1e8) : "—"}</b> 億，年增 <span className={tone(yoy(hm, hv))}>{signed(yoy(hm, hv))}%</span>
      </p>
      <div className="flex h-32 items-end gap-[2px]" role="img" aria-label="近 24 個月營收長條圖" onMouseLeave={() => setHover(null)}>
        {last.map(([m, v], i) => (
          <button key={m} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
            aria-label={`${m} 營收 ${v != null ? n(v / 1e8) : "—"} 億`}
            className="group flex h-full flex-1 items-end">
            <span className={`block w-full rounded-t-[4px] ${i === hi ? "bg-accent" : "bg-accent/45 group-hover:bg-accent/70"}`}
              style={{ height: `${((v ?? 0) / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-xs text-muted">
        <span>{last[0]?.[0]}</span><span>{last[last.length - 1]?.[0]}</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="num w-full min-w-[420px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="text-right"><th scope="col" className="py-1.5 text-left font-medium">月份</th><th scope="col" className="font-medium">營收（億）</th>
              <th scope="col" className="font-medium">月增</th><th scope="col" className="font-medium">年增</th></tr>
          </thead>
          <tbody>
            {[...last].reverse().slice(0, 6).map(([m, v]) => {
              const k = rev.findIndex(([x]) => x === m);
              const pv = k > 0 ? rev[k - 1][1] : null;
              const mom = v != null && pv ? ((v / pv) - 1) * 100 : null;
              const y = yoy(m, v);
              return (
                <tr key={m} className="border-t border-line text-right">
                  <td className="py-1.5 text-left text-muted">{m}</td><td className="text-ink">{v != null ? n(v / 1e8) : "—"}</td>
                  <td className={tone(mom)}>{signed(mom)}%</td><td className={tone(y)}>{signed(y)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------- 季財報 ----------------

function QuartersCard({ s }: { s: StockFile }) {
  const q = [...(s.quarters ?? [])].reverse().slice(0, 8);
  return (
    <Section id="quarters" title="季財報" note="近 8 季；ROE 為單季年化" stamp={quarterStamp(s)}>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[560px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="text-right">
              <th scope="col" className="py-1.5 text-left font-medium">季度</th><th scope="col" className="font-medium">營收（億）</th>
              <th scope="col" className="font-medium">EPS（元）</th><th scope="col" className="font-medium">毛利率</th>
              <th scope="col" className="font-medium">營益率</th><th scope="col" className="font-medium">淨利率</th><th scope="col" className="font-medium">ROE</th>
            </tr>
          </thead>
          <tbody>
            {q.map((r) => (
              <tr key={r.p} className="border-t border-line text-right">
                <td className="py-1.5 text-left text-muted">{r.p}</td>
                <td className="text-ink">{r.rev != null ? n(r.rev / 1e8) : "—"}</td>
                <td className="text-ink">{n(r.eps)}</td>
                <td className="text-ink">{r.gm != null ? `${n(r.gm)}%` : "—"}</td>
                <td className="text-ink">{r.om != null ? `${n(r.om)}%` : "—"}</td>
                <td className="text-ink">{r.nm != null ? `${n(r.nm)}%` : "—"}</td>
                <td className="text-ink">{r.roe != null ? `${n(r.roe)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------- 股利 ----------------

function DividendCard({ s }: { s: StockFile }) {
  const dv = [...(s.dividends ?? [])].reverse().slice(0, 10);
  return (
    <Section id="dividends" title="股利" note="單位：元／股">
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[420px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="text-right"><th scope="col" className="py-1.5 text-left font-medium">所屬期間</th><th scope="col" className="font-medium">現金股利</th>
              <th scope="col" className="font-medium">股票股利</th><th scope="col" className="font-medium">除息日</th></tr>
          </thead>
          <tbody>
            {dv.map((r, i) => (
              <tr key={`${r.period}-${i}`} className="border-t border-line text-right">
                <td className="py-1.5 text-left text-muted">{r.period}</td>
                <td className="text-ink">{n(r.cash, 2)}</td><td className="text-ink">{n(r.stock, 2)}</td>
                <td className="text-muted">{r.ex ? r.ex.replaceAll("-", "/") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
