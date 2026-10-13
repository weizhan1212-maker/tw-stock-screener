"use client";

/** 指數詳細頁：K 線圖（含均線、KD、MACD 等技術指標）、期間漲跌、成分／產業股票列表。 */
import BackLink from "@/components/BackLink";
import KChart from "@/components/KChart";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import DataStatus from "@/components/DataStatus";
import Results, { type Sort } from "@/components/Results";
import { useSnapshot } from "@/hooks/useSnapshot";
import type { Row } from "@/lib/screener";
import type { StockFile } from "@/lib/stock";

interface Series { market: string; d: string[]; c: (number | null)[]; o?: (number | null)[]; h?: (number | null)[]; l?: (number | null)[] }
interface IndicesFile { asof: string; series: Record<string, Series> }

const LABEL: Record<string, string> = { "發行量加權股價指數": "加權指數" };
const label = (n: string) => LABEL[n] ?? n.replace(/類指數$/, "類");
// 指數名稱 → 產業分類關鍵字（FinMind 產業別）
const IND_MAP: Record<string, string[]> = {
  "化學生技醫療": ["化學", "生技醫療"], "電子": ["電子工業"], "電子工業": ["電子工業"],
  "建材營造": ["建材營造"], "航運": ["航運"], "觀光餐旅": ["觀光"], "貿易百貨": ["貿易百貨"],
  "油電燃氣": ["油電燃氣"], "其他電子": ["其他電子"], "電子通路": ["電子通路"], "資訊服務": ["資訊服務"],
};

function pool(name: string, rows: Row[]): { rows: Row[]; note: string } | null {
  const stocks = rows.filter((r) => r.sec_type === "stock");
  if (name === "發行量加權股價指數") return { rows: stocks.filter((r) => r.market === "TWSE"), note: "全部上市普通股" };
  if (name === "櫃買指數") return { rows: stocks.filter((r) => r.market === "TPEX"), note: "全部上櫃普通股" };
  const m = name.match(/^(.+?)類?指數$/);
  if (!m || name.includes("報酬")) return null;
  const key = m[1].replace(/類$/, "");
  const kws = IND_MAP[key] ?? [key];
  const hit = stocks.filter((r) => kws.some((k) => String(r.industry ?? "").includes(k)));
  return hit.length ? { rows: hit, note: `產業分類含「${kws.join("、")}」的上市櫃普通股` } : null;
}

export default function IndexPage({ name: asked }: { name: string }) {
  const router = useRouter();
  const [data, setData] = useState<IndicesFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { snap, error: snapErr } = useSnapshot();
  const [sort, setSort] = useState<Sort>({ key: "market_cap", dir: -1 });

  useEffect(() => {
    fetch("/api/indices")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setData(j); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // 網址可能是完整名稱（半導體類指數）或顯示名稱（半導體類、加權指數），兩種都對得到
  const name = useMemo(() => {
    if (!data || data.series[asked]) return asked;
    return Object.keys(data.series).find((k) => label(k) === asked) ?? asked;
  }, [data, asked]);
  const s = data?.series[name];
  useEffect(() => { document.title = `${label(name)}｜股見未來`; }, [name]);
  const names = useMemo(() => {
    if (!data) return [];
    const key = ["發行量加權股價指數", "櫃買指數", "台指期", "台指期盤後"];
    const rest = Object.keys(data.series).filter((n) => !key.includes(n) && !n.includes("報酬")).sort((a, b) => a.localeCompare(b, "zh-Hant"));
    return [...key.filter((n) => data.series[n]), ...rest];
  }, [data]);

  const stats = useMemo(() => {
    if (!s) return null;
    const c = s.c.filter((x): x is number => x != null);
    const last = c[c.length - 1], prev = c[c.length - 2];
    const ret = (n: number) => (c.length > n ? (last / c[c.length - 1 - n] - 1) * 100 : null);
    const y = c.slice(-250);
    return { last, chg: prev != null ? last - prev : null, pct: prev ? (last / prev - 1) * 100 : null,
      r1m: ret(22), r3m: ret(66), r1y: ret(250), hi: Math.max(...y), lo: Math.min(...y), date: s.d[s.d.length - 1] };
  }, [s]);

  // 指數轉成 K 線圖用的格式；只有收盤價的指數，用「前一日收盤 → 當日收盤」畫 K 棒
  const kfile = useMemo<StockFile | null>(() => {
    if (!s) return null;
    const n = s.d.length;
    const none = Array<null>(n).fill(null);
    const ohlc = !!(s.o && s.h && s.l);
    const o = s.c.map((c, i) => (ohlc ? s.o![i] : i > 0 ? (s.c[i - 1] ?? c) : c));
    const h = s.c.map((c, i) => (ohlc ? s.h![i] : c == null || o[i] == null ? c : Math.max(c, o[i]!)));
    const l = s.c.map((c, i) => (ohlc ? s.l![i] : c == null || o[i] == null ? c : Math.min(c, o[i]!)));
    return {
      code: `IDX:${name}`, asof: s.d[n - 1] ?? "", info: { name: label(name), market: s.market, sec_type: null },
      daily: { d: s.d, o, h, l, c: s.c, v: Array<number>(n).fill(0), f: none, fi: none, it: none, dl: none, mb: none, sb: none },
    };
  }, [s, name]);

  const p = useMemo(() => (snap && data ? pool(name, snap.rows) : null), [snap, data, name]);
  const breadth = useMemo(() => {
    if (!p) return null;
    let up = 0, down = 0, flat = 0, value = 0;
    for (const r of p.rows) {
      const c = r.chg_pct as number | null;
      if (c == null) continue;
      if (c > 0) up++; else if (c < 0) down++; else flat++;
      value += (r.value as number | null) ?? 0;
    }
    return { up, down, flat, value };
  }, [p]);

  const tone = (x: number | null | undefined) => (x == null || x === 0 ? "text-muted" : x > 0 ? "text-up" : "text-down");
  const n2 = (x: number | null | undefined, d = 2) => (x == null ? "—" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (x: number | null | undefined) => (x != null && x > 0 ? "+" : "");

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <nav className="mb-2 text-sm"><BackLink fallback="/" fallbackLabel="市場總覽" /></nav>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <h1 className="text-2xl font-bold text-ink">{label(name)}</h1>
        {stats && (
          <div className="num flex items-baseline gap-2">
            <span className="text-3xl font-bold text-ink">{n2(stats.last)}</span>
            <span className={`text-lg ${tone(stats.chg)}`}>{sg(stats.chg)}{n2(stats.chg)}（{sg(stats.pct)}{n2(stats.pct)}%）</span>
            <span className="text-sm text-muted">{stats.date.replaceAll("-", "/")}</span>
          </div>
        )}
        {names.length > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-sm text-muted">
            切換指數
            <select value={name} onChange={(e) => router.push(`/market/index/${encodeURIComponent(e.target.value)}`)}
              className="max-w-56 rounded-md border border-line bg-surface px-2 py-1 text-ink">
              {names.map((x) => <option key={x} value={x}>{label(x)}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-up">指數資料載入失敗：{error}</p>}
      {data && !s && <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink">找不到「{asked}」的歷史資料。</p>}

      {stats && (
        <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-5">
          {([["近 1 月", stats.r1m], ["近 3 月", stats.r3m], ["近 1 年", stats.r1y]] as const).map(([k, x]) => (
            <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className={tone(x)}>{x == null ? "—" : `${sg(x)}${n2(x)}%`}</dd></div>
          ))}
          <div><dt className="text-xs text-muted">52 週最高</dt><dd className="text-ink">{n2(stats.hi)}</dd></div>
          <div><dt className="text-xs text-muted">52 週最低</dt><dd className="text-ink">{n2(stats.lo)}</dd></div>
        </dl>
      )}

      {s && kfile && (
        <div className="mt-4">
          <KChart key={name} s={kfile} mode="index" />
          <p className="mt-1 text-xs text-muted">
            {s.o ? "日 K 線，紅漲綠跌。" : "這個指數只有每日收盤價，K 棒以前一日收盤到當日收盤繪製（沒有盤中高低點）。"}
            {s.market === "TAIFEX" && "期貨從網站上線起每日累積，歷史較短。"}
          </p>
        </div>
      )}

      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="text-base font-bold text-ink">相關股票</h2>
          <DataStatus snap={snap} error={snapErr} />
        </div>
        {snap && data && !p ? (
          <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">這個指數沒有對應的產業股票清單。</p>
        ) : (
          <>
            {p && breadth && (
              <p className="num mb-2 text-sm text-muted">
                {p.note}，共 {p.rows.length} 檔：<span className="text-up">上漲 {breadth.up}</span>・<span>平盤 {breadth.flat}</span>・
                <span className="text-down">下跌 {breadth.down}</span>・成交金額 {n2(breadth.value / 1e8)} 億
              </p>
            )}
            <Results key={name} rows={p?.rows ?? []} cols={["close", "chg_pct", "volume_lots", "value", "market_cap", "pe", "foreign_net", "trust_net"]}
              sort={sort} setSort={setSort} loading={!snap} csvName={`${label(name)}_${snap?.meta.asof ?? ""}`} countLabel="共" />
          </>
        )}
      </section>
    </div>
  );
}
