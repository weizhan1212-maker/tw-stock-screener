"use client";

/** 個股頁：風險框架（ATR、回撤、關鍵價、部位試算、事件日曆）與財務健康分數解釋。非買賣建議。 */
import { useMemo, useState } from "react";
import { NumInput } from "@/components/Screener";
import Section from "@/components/Section";
import { num, type Row } from "@/lib/screener";
import { type Bar, dailyBars, type StockFile, supportResistance, todayStr } from "@/lib/stock";

const f = (x: number | null | undefined, d = 2) =>
  x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------------- 風險計算 ----------------

function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  let a: number | null = null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    a = a == null ? tr : a + (tr - a) / n;
  }
  return a;
}

function maxDrawdown(closes: number[]) {
  let peak = closes[0], mdd = 0;
  for (const c of closes) { peak = Math.max(peak, c); mdd = Math.min(mdd, c / peak - 1); }
  return mdd * 100;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Ev { date: string; label: string; note?: string }

/** 接下來的事件：除權息（已公告）、月營收公布期限、季報公布期限 */
export function upcomingEvents(s: StockFile, today = todayStr()): Ev[] {
  const out: Ev[] = [];
  for (const d of s.dividends ?? []) {
    if (d.ex && d.ex >= today) out.push({ date: d.ex, label: "除權息", note: `現金 ${f(d.cash)} 元${d.stock ? `、股票 ${f(d.stock)} 元` : ""}` });
  }
  for (const c of s.events?.conf ?? []) {
    if (c.d >= today) out.push({ date: c.d, label: "法人說明會", note: `${c.t ? `${c.t}・` : ""}${c.s}` });
  }
  const [y, m, day] = today.split("-").map(Number);
  const rev = day <= 10 ? `${y}-${String(m).padStart(2, "0")}-10` : m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, "0")}-10`;
  out.push({ date: rev, label: "月營收公布期限", note: "多數公司在 10 日前公布上個月營收" });
  const fin = [[`${y}-03-31`, "年報"], [`${y}-05-15`, "第一季財報"], [`${y}-08-14`, "第二季財報"], [`${y}-11-14`, "第三季財報"], [`${y + 1}-03-31`, "年報"]]
    .find(([d]) => d >= today)!;
  out.push({ date: fin[0], label: `${fin[1]}公布期限`, note: "法定最後期限，公司可能提早公布" });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

type StopMode = "atr" | "support" | "custom";

export function RiskCard({ s, row }: { s: StockFile; row?: Row }) {
  const bars = useMemo(() => dailyBars(s, true), [s]);
  const m = useMemo(() => {
    if (bars.length < 30) return null;
    const closes = bars.map((b) => b.c);
    const last = closes[closes.length - 1];
    const a = atr(bars.slice(-120));
    const lv = supportResistance(bars);
    const ma20 = closes.length >= 20 ? mean(closes.slice(-20)) : null;
    const ma60 = closes.length >= 60 ? mean(closes.slice(-60)) : null;
    const rets = closes.slice(-21).map((c, i, arr) => (i ? c / arr[i - 1] - 1 : 0)).slice(1);
    const sd = Math.sqrt(mean(rets.map((r) => (r - mean(rets)) ** 2)));
    return {
      last, atr: a, atrPct: a ? (a / last) * 100 : null, mdd20: maxDrawdown(closes.slice(-20)), mdd60: maxDrawdown(closes.slice(-60)),
      vol20: sd * Math.sqrt(252) * 100, support: lv.supports[0] ?? null, resistance: lv.resistances[0] ?? null, ma20, ma60,
    };
  }, [bars]);

  const [capital, setCapital] = useState<number | undefined>(1_000_000);
  const [riskPct, setRiskPct] = useState<number | undefined>(1);
  const [entry, setEntry] = useState<number | undefined>(undefined);
  const [mode, setMode] = useState<StopMode>("atr");
  const [mult, setMult] = useState<number | undefined>(2);
  const [custom, setCustom] = useState<number | undefined>(undefined);
  const events = useMemo(() => upcomingEvents(s), [s]);

  if (!m) return null;
  const px = entry ?? m.last;
  const stop = mode === "atr" ? (m.atr ? px - (mult ?? 2) * m.atr : null)
    : mode === "support" ? (m.support ? m.support.lo * 0.99 : null) : custom ?? null;
  const perShare = stop != null ? px - stop : null;
  const budget = (capital ?? 0) * (riskPct ?? 0) / 100;
  let shares = perShare && perShare > 0 ? Math.floor(budget / perShare) : 0;
  if (capital && shares * px > capital) shares = Math.floor(capital / px);      // 不超過總資金
  const lots = Math.floor(shares / 1000), odd = shares % 1000;
  const today = todayStr();
  const isEtf = s.info.sec_type === "etf";

  return (
    <Section id="risk" title="風險框架與部位試算" note="用自己的風險承受度估算，非買賣建議">
      <dl className="num grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="每日平均波動（ATR）" value={`${f(m.atr)} 元`} sub={`約股價 ${f(m.atrPct, 1)}%`} />
        <Stat label="近 20 日最大回撤" value={`${f(m.mdd20, 1)}%`} sub={`近 60 日 ${f(m.mdd60, 1)}%`} />
        <Stat label="近 20 日年化波動" value={`${f(m.vol20, 0)}%`} sub={num(row?.atr_pct) != null ? "大盤約 15～25%" : undefined} />
        <Stat label="最近支撐／壓力" value={`${m.support ? f(m.support.lo) : "—"}／${m.resistance ? f(m.resistance.lo) : "—"}`} sub="還原價，見支撐與壓力" />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-md bg-surface-2 p-3 text-sm leading-relaxed text-ink">
          <h3 className="font-bold">看法失效的訊號（參考）</h3>
          <ul className="mt-1 space-y-1">
            {m.support && <li>· 收盤跌破最近支撐區 {f(m.support.lo)}（距今 {f((m.support.lo / m.last - 1) * 100, 1)}%）：短線支撐失守</li>}
            {m.ma20 && <li>· 收盤跌破月線 {f(m.ma20)}（{m.last >= m.ma20 ? "目前在上方" : "目前已在下方"}）：短線轉弱</li>}
            {m.ma60 && <li>· 收盤跌破季線 {f(m.ma60)}（{m.last >= m.ma60 ? "目前在上方" : "目前已在下方"}）：中期趨勢轉弱</li>}
            {m.atr && <li>· 一天跌超過 {f(2 * m.atr)} 元（2 倍 ATR）：波動明顯放大</li>}
          </ul>
          {m.resistance && <p className="mt-2 text-xs text-muted">上方最近壓力 {f(m.resistance.lo)}（距今 +{f((m.resistance.lo / m.last - 1) * 100, 1)}%），突破前可能遇到賣壓。</p>}
        </div>

        <div className="rounded-md bg-surface-2 p-3 text-sm text-ink">
          <h3 className="font-bold">部位大小試算</h3>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="總資金（元）"><NumInput value={capital} onChange={setCapital} label="總資金" /></Field>
            <Field label="一筆最多虧損（%）"><NumInput value={riskPct} onChange={setRiskPct} label="一筆最多虧損" /></Field>
            <Field label="進場價"><NumInput value={entry ?? Number(m.last.toFixed(2))} onChange={setEntry} label="進場價" /></Field>
            <Field label="停損方式">
              <select value={mode} onChange={(e) => setMode(e.target.value as StopMode)} className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-sm text-ink" aria-label="停損方式">
                <option value="atr">ATR 倍數</option><option value="support">支撐下緣</option><option value="custom">自己輸入</option>
              </select>
            </Field>
            {mode === "atr" && <Field label="ATR 倍數"><NumInput value={mult} onChange={setMult} label="ATR 倍數" /></Field>}
            {mode === "custom" && <Field label="停損價"><NumInput value={custom} onChange={setCustom} label="停損價" /></Field>}
          </div>
          <div className="num mt-3 space-y-1 border-t border-line pt-2">
            <p>停損價 <b>{f(stop)}</b>（每股風險 {f(perShare)} 元，{perShare && px ? f((perShare / px) * 100, 1) : "—"}%）</p>
            {perShare != null && perShare > 0 ? (
              <p>最多可買 <b>{shares.toLocaleString()}</b> 股（{lots} 張{odd ? ` ＋ ${odd} 股零股` : ""}），約 {f(shares * px, 0)} 元，占資金 {capital ? f((shares * px / capital) * 100, 1) : "—"}%；停損時虧約 {f(shares * perShare, 0)} 元</p>
            ) : <p className="text-warn-ink">停損價要低於進場價才能試算。</p>}
          </div>
          <p className="mt-2 text-xs text-muted">公式：可買股數 ＝ 總資金 × 一筆最多虧損 ÷ 每股風險（不超過總資金）。未計手續費、稅與跳空。</p>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-bold text-ink">接下來的事件</h3>
        <ul className="mt-1 divide-y divide-line text-sm">
          {events.map((e) => {
            const d = daysBetween(today, e.date);
            return (
              <li key={e.label + e.date} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className={`num w-24 ${d <= 7 ? "font-bold text-warn-ink" : "text-ink"}`}>{e.date}</span>
                <span className="text-ink">{e.label}</span>
                <span className="text-xs text-muted">{d === 0 ? "今天" : `${d} 天後`}{e.note ? `・${e.note}` : ""}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-xs text-muted">
          除權息為已公告的日期；{isEtf ? "ETF 沒有月營收與財報，請以投信公告為準；" : ""}法人說明會取自公司的重大訊息公告，上線前已公告的場次可能沒有，請到公開資訊觀測站確認。
        </p>
      </div>
    </Section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-bold text-ink">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-muted">{label}{children}</label>;
}

// ---------------- 財務健康解釋 ----------------

const PARTS: { key: string; label: string; metrics: [string, string, boolean, boolean][] }[] = [
  // [欄位, 名稱, 越高越好, 金融股也算]
  { key: "hs_profit", label: "盈利能力", metrics: [["roe", "ROE", true, true], ["roa", "ROA", true, true], ["gross_margin", "毛利率", true, false], ["op_margin", "營業利益率", true, false]] },
  { key: "hs_liquid", label: "流動性", metrics: [["current_ratio", "流動比率", true, false], ["fcf_ttm", "近四季自由現金流", true, false]] },
  { key: "hs_struct", label: "財務結構", metrics: [["debt_ratio", "負債比", false, false]] },
  { key: "hs_eff", label: "營運效率", metrics: [["asset_turnover", "資產周轉率", true, false], ["f_score", "F-Score", true, false]] },
  { key: "hs_growth", label: "成長性", metrics: [["rev_ttm_yoy", "近 12 月營收年增", true, true], ["eps_q_yoy", "單季 EPS 年增", true, true], ["eps_cagr3", "EPS 3 年年化成長", true, true]] },
];
const GRADES: [number, string][] = [[35, "C"], [45, "C+"], [55, "B"], [65, "B+"], [75, "A"], [85, "A+"]];

function pctRank(rows: Row[], key: string, v: number, higher: boolean): number | null {
  const xs = rows.map((r) => num(r[key])).filter((x): x is number => x != null);
  if (!xs.length) return null;
  const below = xs.filter((x) => (higher ? x < v : x > v)).length, eq = xs.filter((x) => x === v).length;
  return ((below + eq / 2) / xs.length) * 100;
}

export function HealthExplain({ rows, row, s }: { rows: Row[]; row: Row; s?: StockFile | null }) {
  const fin = row.is_financial === 1;
  const stocks = useMemo(() => rows.filter((r) => r.sec_type === "stock"), [rows]);
  const score = num(row.health_score);
  const detail = useMemo(() => PARTS.map((p) => ({
    ...p,
    score: num(row[p.key]),
    items: p.metrics.filter(([, , , okFin]) => !fin || okFin).map(([k, label, higher]) => {
      const v = num(row[k]);
      const peers = stocks.filter((r) => (r.is_financial === 1) === fin || okForAll(k));
      return { k, label, v, pct: v == null ? null : pctRank(peers, k, v, higher) };
    }),
  })), [row, stocks, fin]);
  const next = score == null ? null : GRADES.find(([t]) => t > score);
  const peers = useMemo(() => stocks.filter((r) => r.ind && r.ind === row.ind && num(r.health_score) != null), [stocks, row.ind]);
  const peerPct = score != null && peers.length > 2 ? pctRank(peers, "health_score", score, true) : null;
  const weakest = detail.flatMap((d) => d.items).filter((x) => x.pct != null).sort((a, b) => a.pct! - b.pct!).slice(0, 3);
  const warns: string[] = [];
  for (const d of detail) if (d.score == null && !(fin && d.key !== "hs_profit" && d.key !== "hs_growth")) warns.push(`${d.label}資料不足，沒有計分`);
  const eqy = num(row.eps_q_yoy);
  if (eqy != null && Math.abs(eqy) > 300) warns.push(`單季 EPS 年增 ${f(eqy, 0)}%，去年同期基期很低或為虧損，成長分數可能被放大`);
  if ((s?.quarters?.length ?? 0) < 4) warns.push("財報不足 4 季（新上市或資料補齊中）");
  const q = s?.quarters ?? [];
  const trend = (k: "gm" | "om" | "roe") => {
    const xs = q.map((x) => x[k]).filter((x): x is number => x != null);
    return xs.length >= 4 ? { first: xs[0], last: xs[xs.length - 1], n: xs.length } : null;
  };

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-3 text-sm text-ink">
      {fin && <p className="rounded-md bg-warn-bg px-3 py-2 font-bold text-warn-ink">金融股：只計「盈利能力」與「成長性」兩項（流動比率、負債比、周轉率不適用），分數不宜跟一般產業直接比較。</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-surface-2 p-3">
          <div className="text-xs text-muted">距離下一級</div>
          <div className="mt-0.5 font-bold">{score == null ? "—" : next ? `再 ${f(next[0] - score, 0)} 分升到 ${next[1]}` : "已是最高級 A+"}</div>
          <div className="text-xs text-muted">分級：A+ ≥85、A ≥75、B+ ≥65、B ≥55、C+ ≥45、C ≥35</div>
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          <div className="text-xs text-muted">同產業比較{row.ind ? `（${row.ind as string}）` : ""}</div>
          <div className="mt-0.5 font-bold">{peerPct == null ? "同業太少" : `贏過 ${f(peerPct, 0)}% 的同業`}</div>
          <div className="text-xs text-muted">{peers.length} 家有分數</div>
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          <div className="text-xs text-muted">主要扣分來源（全市場百分位最低）</div>
          <div className="mt-0.5 font-bold">{weakest.length ? weakest.map((w) => `${w.label} ${f(w.pct, 0)}`).join("、") : "—"}</div>
        </div>
      </div>

      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 text-sm">每一項怎麼算（數值與全市場百分位）</summary>
        <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
          {detail.map((d) => (
            <div key={d.key}>
              <div className="flex justify-between font-bold"><span>{d.label}</span><span className="num">{d.score == null ? "不計" : f(d.score, 0)}</span></div>
              <ul className="num mt-1 space-y-0.5 text-xs">
                {d.items.map((x) => (
                  <li key={x.k} className="flex justify-between gap-2">
                    <span className="text-muted">{x.label} {fmtMetric(x.k, x.v)}</span>
                    <span className={x.pct == null ? "text-muted" : x.pct < 30 ? "text-down" : x.pct > 70 ? "text-up" : "text-ink"}>{x.pct == null ? "—" : `${f(x.pct, 0)}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="px-3 pb-3 text-xs text-muted">百分位 100 ＝ 全市場最好、0 ＝ 最差；每一面向取各項平均，總分取五個面向平均（至少要有 4 項，金融股 2 項）。</p>
      </details>

      {q.length >= 4 && (
        <p className="text-xs text-muted">
          近 {q.length} 季趨勢：
          {(["gm", "om", "roe"] as const).map((k) => {
            const t = trend(k);
            if (!t) return null;
            const up = t.last > t.first;
            return <span key={k} className="mr-3">{{ gm: "毛利率", om: "營益率", roe: "ROE" }[k]} {f(t.first, 1)}% → {f(t.last, 1)}% <span className={up ? "text-up" : "text-down"}>{up ? "▲" : "▼"}</span></span>;
          })}
        </p>
      )}
      {warns.length > 0 && (
        <ul className="space-y-0.5 text-xs text-warn-ink">{warns.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
      )}
    </div>
  );
}

const okForAll = (k: string) => ["roe", "roa", "rev_ttm_yoy", "eps_q_yoy", "eps_cagr3"].includes(k);

function fmtMetric(k: string, v: number | null) {
  if (v == null) return "—";
  if (k === "fcf_ttm") return `${f(v / 1e8, 1)} 億`;
  if (k === "current_ratio" || k === "asset_turnover") return `${f(v)} 倍`;
  if (k === "f_score") return `${f(v, 0)} 分`;
  return `${f(v, 1)}%`;
}

// ---------------- ETF 資訊 ----------------

export function EtfInfoCard({ row, s }: { row: Row; s?: StockFile | null }) {
  const div = [...(s?.dividends ?? [])].sort((a, b) => (b.ex ?? b.period).localeCompare(a.ex ?? a.period));
  const items: [string, string][] = [
    ["規模（估算）", num(row.etf_aum) == null ? "—" : `${f(num(row.etf_aum), 0)} 億`],
    ["受益人數", num(row.holders) == null ? "—" : `${Math.round(num(row.holders)!).toLocaleString()} 人`],
    ["近一年配息", num(row.etf_div12m) == null ? "—" : `${f(num(row.etf_div12m))} 元（${f(num(row.etf_div_count), 0)} 次）`],
    ["殖利率（近一年）", num(row.dividend_yield) == null ? "—" : `${f(num(row.dividend_yield))}%`],
    ["近一年報酬（含息）", num(row.ret240) == null ? "—" : `${f(num(row.ret240), 1)}%`],
  ];
  return (
    <Section id="etf" title="ETF 資訊" note="規模＝發行單位數 × 收盤價（估算）；受益人數每週更新">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {items.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>)}
      </dl>
      {div.length > 0 && <p className="num mt-3 text-xs text-muted">最近配息：{div.slice(0, 6).map((d) => `${d.ex ?? d.period} ${f(d.cash, 3)} 元`).join("、")}</p>}
    </Section>
  );
}

// ---------------- 估值情境 ----------------

/** 每季財報的法定公布期限（之後才算「已知」的 EPS） */
function availDate(p: string) {
  const y = Number(p.slice(0, 4)), q = Number(p.slice(5));
  return q === 1 ? `${y}-05-15` : q === 2 ? `${y}-08-14` : q === 3 ? `${y}-11-14` : `${y + 1}-03-31`;
}

function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** 近 3 年每天的本益比（收盤價 ÷ 當時已公布的近四季 EPS） */
export function peHistory(s: StockFile, years = 3): number[] {
  const q = (s.quarters ?? []).filter((x) => x.eps != null);
  if (q.length < 4) return [];
  const ttm = q.slice(3).map((x, i) => ({ from: availDate(x.p), eps: q.slice(i, i + 4).reduce((a, b) => a + (b.eps ?? 0), 0) }));
  const d = s.daily, start = `${Number(d.d[d.d.length - 1].slice(0, 4)) - years}${d.d[d.d.length - 1].slice(4)}`;
  const out: number[] = [];
  let k = -1;
  for (let i = 0; i < d.d.length; i++) {
    const t = d.d[i], c = d.c[i];
    while (k + 1 < ttm.length && ttm[k + 1].from <= t) k++;
    if (t < start || c == null || k < 0 || ttm[k].eps <= 0) continue;
    out.push(c / ttm[k].eps);
  }
  return out;
}

export function ValuationCard({ s, row }: { s: StockFile; row: Row }) {
  const pes = useMemo(() => peHistory(s), [s]);
  const close = num(row.close);
  const epsTtm = num(row.eps_ttm);
  const [eps, setEps] = useState<number | undefined>(undefined);
  const [yields, setYields] = useState<[number, number, number]>([4, 5, 6]);
  const div = num(row.cash_div_last);
  if (close == null) return null;
  const E = eps ?? epsTtm ?? undefined;
  const band = pes.length >= 120 ? { lo: quantile(pes, 0.25), mid: quantile(pes, 0.5), hi: quantile(pes, 0.75), min: quantile(pes, 0.05), max: quantile(pes, 0.95) } : null;
  const curPe = epsTtm && epsTtm > 0 ? close / epsTtm : null;
  const row3 = (label: string, pe: number) => {
    const p = E != null ? E * pe : null;
    return { label, pe, p, up: p != null ? (p / close - 1) * 100 : null };
  };
  const scen = band ? [row3("偏低（25%）", band.lo), row3("中間（50%）", band.mid), row3("偏高（75%）", band.hi)] : [];
  const where = band && curPe != null ? (curPe <= band.lo ? "偏低區" : curPe >= band.hi ? "偏高區" : "中間區") : null;

  return (
    <Section id="valuation" title="估值情境" note="用歷史本益比區間換算價格，只是情境推算，不是目標價">
      {!band ? (
        <p className="text-sm text-muted">{epsTtm != null && epsTtm <= 0 ? "近四季虧損，本益比不適用。" : "獲利資料不足 3 年，無法計算本益比區間。"}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="text-sm text-ink">
            <p>近 3 年本益比區間：<span className="num">{f(band.min, 1)}～{f(band.max, 1)} 倍</span>（中位數 <span className="num">{f(band.mid, 1)}</span> 倍）</p>
            <p className="mt-1">目前本益比 <b className="num">{f(curPe, 1)}</b> 倍，位於歷史<b>{where}</b>。</p>
            <PeBar band={band} cur={curPe} />
            <label className="mt-3 flex items-center gap-2 text-sm">
              <span>假設未來四季 EPS</span>
              <NumInput value={E} onChange={setEps} label="假設 EPS" />
              <span className="text-muted">元（預設＝近四季 {f(epsTtm)}）</span>
            </label>
          </div>
          <table className="num w-full self-start text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">情境</th><th className="text-right font-medium">本益比</th><th className="text-right font-medium">推算價格</th><th className="text-right font-medium">相對現價</th></tr></thead>
            <tbody>
              {scen.map((x) => (
                <tr key={x.label} className="border-t border-line">
                  <td className="py-1.5 text-ink">{x.label}</td>
                  <td className="text-right text-ink">{f(x.pe, 1)}</td>
                  <td className="text-right text-ink">{f(x.p)}</td>
                  <td className={`text-right ${x.up == null ? "" : x.up >= 0 ? "text-up" : "text-down"}`}>{x.up == null ? "—" : `${x.up > 0 ? "+" : ""}${f(x.up, 1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {div != null && div > 0 && (
        <div className="mt-4 border-t border-line pt-3 text-sm text-ink">
          <p className="font-bold">殖利率法（存股族常用）</p>
          <p className="num mt-1">最近一年現金股利 {f(div)} 元；想要的殖利率：
            {yields.map((y, i) => (
              <span key={i} className="mx-1 inline-flex items-center gap-1">
                <NumInput value={y} label={`殖利率 ${i + 1}`} onChange={(n) => n != null && n > 0 && setYields((ys) => ys.map((v, j) => (j === i ? n : v)) as [number, number, number])} />%
              </span>
            ))}
          </p>
          <p className="num mt-1">對應價格：{yields.map((y) => `${f(y, 1)}% → ${f(div / (y / 100))} 元`).join("；")}（現價 {f(close)}）</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">本益比用「當時已公布」的近四季 EPS 計算；推算價格＝假設 EPS × 歷史本益比。景氣循環股在獲利高峰時本益比最低，用這個方法容易誤判。</p>
    </Section>
  );
}

function PeBar({ band, cur }: { band: { min: number; lo: number; mid: number; hi: number; max: number }; cur: number | null }) {
  const span = band.max - band.min || 1;
  const x = (v: number) => `${Math.min(100, Math.max(0, ((v - band.min) / span) * 100))}%`;
  return (
    <div className="relative mt-3 h-6" aria-hidden>
      <div className="absolute top-2.5 h-1.5 w-full rounded-full bg-surface-2" />
      <div className="absolute top-2.5 h-1.5 rounded-full bg-accent-soft" style={{ left: x(band.lo), width: `calc(${x(band.hi)} - ${x(band.lo)})` }} />
      {cur != null && <div className="absolute top-0.5 h-5 w-0.5 bg-accent" style={{ left: x(cur) }} />}
    </div>
  );
}

// ---------------- 事件統計 ----------------

interface EvStat { label: string; n: number; avg: number | null; win: number | null }
function statOf(label: string, xs: number[]): EvStat {
  return { label, n: xs.length, avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, win: xs.length ? (xs.filter((x) => x > 0).length / xs.length) * 100 : null };
}

export function eventStats(s: StockFile) {
  const d = s.daily;
  const adj = d.c.map((c, i) => (c == null ? null : c * (d.f[i] ?? 1)));
  const idxOf = (date: string) => { let i = d.d.findIndex((x) => x >= date); if (i < 0) i = d.d.length; return i; };   // 第一個 ≥ date 的交易日
  const ret = (i0: number, i1: number) => {
    if (i0 < 0 || i1 >= d.d.length || i1 <= i0) return null;
    const a = adj[i0], b = adj[i1];
    return a && b ? (b / a - 1) * 100 : null;
  };
  // 除權息：填息天數、除息前 5 日、除息當天
  const divs = (s.dividends ?? []).filter((x) => x.ex && x.ex >= d.d[0] && x.ex <= d.d[d.d.length - 1] && (x.cash ?? 0) + (x.stock ?? 0) > 0);
  const fill: number[] = [], pre: number[] = [], day: number[] = [];
  let notFilled = 0;
  const rows: { ex: string; cash: number | null; days: number | null }[] = [];
  for (const x of divs) {
    const i = idxOf(x.ex!);
    if (i <= 0 || i >= d.d.length) continue;
    const prevClose = d.c[i - 1];
    let k: number | null = null;
    if (prevClose != null) for (let j = i; j < d.d.length; j++) if ((d.c[j] ?? 0) >= prevClose) { k = j - i + 1; break; }
    if (k == null) notFilled++; else fill.push(k);
    rows.push({ ex: x.ex!, cash: x.cash, days: k });
    const r1 = ret(i - 6, i - 1); if (r1 != null) pre.push(r1);
    const r2 = ret(i - 1, i); if (r2 != null) day.push(r2);
  }
  // 月營收：上個月底 → 公布期限（10 日）後 5 個交易日
  const rev = s.revenue ?? [];
  const revMap = new Map(rev.map(([m, v]) => [m, v]));
  const grp: Record<string, number[]> = { up: [], flat: [], down: [] };
  for (const [m, v] of rev) {
    const [y, mo] = m.split("-").map(Number);
    const ly = revMap.get(`${y - 1}-${String(mo).padStart(2, "0")}`);
    if (v == null || ly == null || ly <= 0) continue;
    const yoy = (v / ly - 1) * 100;
    const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
    const start = idxOf(`${ny}-${String(nm).padStart(2, "0")}-01`) - 1;
    const dl = idxOf(`${ny}-${String(nm).padStart(2, "0")}-11`);
    const r = ret(start, dl + 4);
    if (r == null) continue;
    (yoy >= 20 ? grp.up : yoy >= 0 ? grp.flat : grp.down).push(r);
  }
  // 季報：公布期限前 5 日 → 後 5 日，依 EPS 年增分組
  const q = s.quarters ?? [];
  const qg: Record<string, number[]> = { up: [], down: [] };
  q.forEach((x, i) => {
    if (i < 4 || x.eps == null || q[i - 4].eps == null) return;
    const dl = idxOf(availDate(x.p));
    const r = ret(dl - 5, dl + 5);
    if (r == null) return;
    (x.eps > (q[i - 4].eps as number) ? qg.up : qg.down).push(r);
  });
  return {
    div: { n: rows.length, filled: fill.length, notFilled, avgDays: fill.length ? fill.reduce((a, b) => a + b, 0) / fill.length : null,
      medDays: fill.length ? [...fill].sort((a, b) => a - b)[Math.floor(fill.length / 2)] : null, pre: statOf("除息前 5 日", pre), day: statOf("除息當天", day), rows: rows.reverse() },
    revenue: [statOf("營收年增 ≥ 20%", grp.up), statOf("年增 0～20%", grp.flat), statOf("營收衰退", grp.down)],
    quarter: [statOf("EPS 比去年同季成長", qg.up), statOf("EPS 比去年同季衰退", qg.down)],
  };
}

/** 重大訊息：證交所／櫃買中心每日開放資料，每天累積。第 12 款是法人說明會。 */
export function NoticesCard({ s }: { s: StockFile }) {
  const ev = s.events;
  const today = todayStr();
  const upcoming = (ev?.conf ?? []).filter((c) => c.d >= today).sort((a, b) => a.d.localeCompare(b.d));
  return (
    <Section id="notices" title="重大訊息" note="證交所、櫃買中心每日公告的開放資料；只有本站上線後累積的部分，完整歷史請到公開資訊觀測站">
      {upcoming.length > 0 && (
        <div className="mb-3 rounded-md bg-accent-soft px-3 py-2 text-sm">
          <b className="text-ink">即將舉行的法人說明會：</b>
          {upcoming.map((c) => (
            <span key={c.d + c.s} className="ml-2 inline-block"><span className="num font-bold text-ink">{c.d}{c.t ? ` ${c.t}` : ""}</span><span className="ml-1 text-xs text-muted">（{daysBetween(today, c.d)} 天後）</span></span>
          ))}
        </div>
      )}
      {!ev || ev.recent.length === 0 ? (
        <p className="text-sm text-muted">目前沒有累積到這檔股票的重大訊息（本站每日自動累積，之後有公告就會出現在這裡）。</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {ev.recent.map((e, i) => (
            <li key={`${e.d}${e.t}${i}`} className="py-2">
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="num w-[7.5rem] shrink-0 text-xs text-muted">{e.d} {e.t}</span>
                  <span className="min-w-0 flex-1 text-ink">{e.c === 12 && <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">法說會</span>}{e.s}</span>
                  <span className="text-xs text-muted group-open:hidden">展開</span>
                </summary>
                {e.b && <p className="mt-2 whitespace-pre-line rounded-md bg-surface-2 p-3 text-xs leading-relaxed text-ink">{e.b}{e.b.length >= 600 ? "…（全文請見公開資訊觀測站）" : ""}</p>}
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">公告內容為公司自行申報，本站只原文呈現，不做利多利空判斷，也不構成投資建議。</p>
    </Section>
  );
}

export function EventStatsCard({ s }: { s: StockFile }) {
  const e = useMemo(() => eventStats(s), [s]);
  const head = <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">情況</th><th className="text-right font-medium">次數</th><th className="text-right font-medium">平均報酬</th><th className="text-right font-medium">上漲機率</th></tr></thead>;
  return (
    <Section id="events" title="事件統計" note="這檔股票過去事件前後的股價表現（還原價），樣本少時參考性低">
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <h3 className="text-sm font-bold text-ink">除權息與填息</h3>
          {e.div.n === 0 ? <p className="mt-1 text-sm text-muted">資料期間內沒有除權息紀錄。</p> : (
            <>
              <p className="num mt-1 text-sm text-ink">近 {e.div.n} 次：{e.div.filled} 次已填息{e.div.notFilled ? `、${e.div.notFilled} 次尚未填息` : ""}；填息天數中位數 <b>{e.div.medDays ?? "—"}</b> 個交易日</p>
              <table className="num mt-2 w-full text-sm">{head}<tbody><EvRow x={e.div.pre} /><EvRow x={e.div.day} /></tbody></table>
              <p className="num mt-2 text-xs text-muted">{e.div.rows.slice(0, 6).map((r) => `${r.ex}（${r.days == null ? "未填息" : `${r.days} 天填息`}）`).join("、")}</p>
            </>
          )}
        </div>
        <div>
          <h3 className="text-sm font-bold text-ink">月營收公布前後</h3>
          <table className="num mt-1 w-full text-sm">{head}<tbody>{e.revenue.map((x) => <EvRow key={x.label} x={x} />)}</tbody></table>
          <p className="mt-1 text-xs text-muted">期間：上個月底收盤 → 10 日公布期限後 5 個交易日。</p>
        </div>
        <div>
          <h3 className="text-sm font-bold text-ink">季報公布前後</h3>
          <table className="num mt-1 w-full text-sm">{head}<tbody>{e.quarter.map((x) => <EvRow key={x.label} x={x} />)}</tbody></table>
          <p className="mt-1 text-xs text-muted">期間：法定公布期限前 5 日 → 後 5 日（公司可能提早公布）。</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">過去的反應不代表下次一定一樣；法說會與重大訊息從 2026-10-08 起每日累積，樣本夠多後再加入統計。</p>
    </Section>
  );
}

function EvRow({ x }: { x: EvStat }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 text-ink">{x.label}</td>
      <td className="text-right text-muted">{x.n}</td>
      <td className={`text-right ${x.avg == null ? "" : x.avg >= 0 ? "text-up" : "text-down"}`}>{x.avg == null ? "—" : `${x.avg > 0 ? "+" : ""}${f(x.avg, 1)}%`}</td>
      <td className="text-right text-ink">{x.win == null ? "—" : `${f(x.win, 0)}%`}</td>
    </tr>
  );
}
