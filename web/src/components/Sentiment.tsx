"use client";

/** 市場情緒：本站自算恐懼與貪婪指數、選擇權 Put/Call 比、期貨大額交易人與三大法人未平倉、美元兌新台幣、景氣燈號。 */
import Sparkline from "@/components/Sparkline";

type Comp = { key: string; label: string; value: number | null; unit: string; score: number | null };
export interface SentimentData {
  fear_greed?: { score: number; label: string; components: Comp[] };
  pcr?: { date: string; oi: number | null; vol: number | null; series: (number | null)[] };
  fut_large?: { date: string; top5_net: number | null; top10_net: number | null; top10_net_inst: number | null; oi: number | null; series: (number | null)[] };
  fut_insti?: { date: string; foreign_oi_net: number | null; trust_oi_net: number | null; dealer_oi_net: number | null; series: (number | null)[] };
  fx?: { date: string; usd_twd: number | null; chg20: number | null; series: (number | null)[] };
  business_light?: { latest: { month: string; score: number; light: string }; series: { month: string; score: number; light: string }[]; source: string };
}

const n0 = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`);
const f = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
const md = (d?: string) => (d ? d.slice(5).replace("-", "/") : "");

// 景氣燈號顏色（國發會定義：藍 9–16、黃藍 17–22、綠 23–31、黃紅 32–37、紅 38–45）
function lightOf(score: number) {
  if (score >= 38) return { name: "紅燈", cls: "bg-red-600" };
  if (score >= 32) return { name: "黃紅燈", cls: "bg-orange-500" };
  if (score >= 23) return { name: "綠燈", cls: "bg-emerald-600" };
  if (score >= 17) return { name: "黃藍燈", cls: "bg-sky-400" };
  return { name: "藍燈", cls: "bg-blue-700" };
}

function Gauge({ score }: { score: number }) {
  // 半圓儀表：0 恐懼（綠）→ 100 貪婪（紅），符合紅漲綠跌習慣
  const a = Math.PI * (1 - score / 100);
  const x = 60 + 46 * Math.cos(a), y = 60 - 46 * Math.sin(a);
  return (
    <svg viewBox="0 0 120 68" className="h-24 w-40" role="img" aria-label={`恐懼與貪婪指數 ${Math.round(score)}`}>
      <defs>
        <linearGradient id="fg" x1="0" x2="1">
          <stop offset="0" stopColor="var(--down)" /><stop offset="0.5" stopColor="var(--muted)" /><stop offset="1" stopColor="var(--up)" />
        </linearGradient>
      </defs>
      <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="url(#fg)" strokeWidth="10" strokeLinecap="round" />
      <line x1="60" y1="60" x2={x} y2={y} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="60" cy="60" r="4" fill="var(--ink)" />
    </svg>
  );
}

export default function Sentiment({ s, asof }: { s?: SentimentData; asof: string }) {
  if (!s || (!s.fear_greed && !s.pcr && !s.fx)) return null;
  const fg = s.fear_greed;
  const bl = s.business_light;
  const late = (d?: string) => (d && d < asof ? "rounded bg-warn-bg px-1 text-warn-ink" : "text-muted");
  return (
    <section className="mt-3 rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">市場情緒</h2>
        <span className="text-xs text-muted">每日盤後；期貨與選擇權資料來自期交所</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {fg && (
          <div className="flex flex-col items-center rounded-md bg-surface-2 p-3 text-center">
            <Gauge score={fg.score} />
            <div className="num -mt-1 text-2xl font-bold text-ink">{Math.round(fg.score)}</div>
            <div className={`text-sm font-bold ${fg.score > 55 ? "text-up" : fg.score < 45 ? "text-down" : "text-ink"}`}>{fg.label}</div>
            <p className="mt-1 text-xs text-muted">本站自算的恐懼與貪婪指數（0～100），由右邊 {fg.components.filter((c) => c.score != null).length} 項平均</p>
          </div>
        )}
        <div className="space-y-3">
          {fg && (
            <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {fg.components.map((c) => (
                <li key={c.key}>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink">{c.label}<span className="ml-1 text-xs text-muted">{f(c.value, 1)}{c.unit}</span></span>
                    <span className="num text-ink">{c.score == null ? "資料累積中" : Math.round(c.score)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className={`h-full rounded-full ${c.score == null ? "" : c.score > 55 ? "bg-up" : c.score < 45 ? "bg-down" : "bg-muted"}`} style={{ width: `${c.score ?? 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <dl className="num grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {s.pcr && (
              <div className="rounded-md bg-surface-2 p-2.5">
                <dt className="text-xs text-muted">選擇權 Put/Call 比 <span className={late(s.pcr.date)}>{md(s.pcr.date)}</span></dt>
                <dd className="font-bold text-ink">{f(s.pcr.oi)}%<span className="ml-1 text-xs font-normal text-muted">未平倉</span></dd>
                <dd className="text-xs text-muted">成交量 {f(s.pcr.vol)}%；越高代表避險越多</dd>
              </div>
            )}
            {s.fut_insti && (
              <div className="rounded-md bg-surface-2 p-2.5">
                <dt className="text-xs text-muted">外資台指期未平倉 <span className={late(s.fut_insti.date)}>{md(s.fut_insti.date)}</span></dt>
                <dd className={`font-bold ${(s.fut_insti.foreign_oi_net ?? 0) >= 0 ? "text-up" : "text-down"}`}>{n0(s.fut_insti.foreign_oi_net)} 口</dd>
                <dd className="text-xs text-muted">投信 {n0(s.fut_insti.trust_oi_net)}、自營 {n0(s.fut_insti.dealer_oi_net)}</dd>
                {s.fut_insti.series.length > 2 && <Sparkline data={s.fut_insti.series} up={null} width={140} height={24} />}
              </div>
            )}
            {s.fut_large && (
              <div className="rounded-md bg-surface-2 p-2.5">
                <dt className="text-xs text-muted">大額交易人淨部位 <span className={late(s.fut_large.date)}>{md(s.fut_large.date)}</span></dt>
                <dd className={`font-bold ${(s.fut_large.top10_net ?? 0) >= 0 ? "text-up" : "text-down"}`}>前十大 {n0(s.fut_large.top10_net)} 口</dd>
                <dd className="text-xs text-muted">前五大 {n0(s.fut_large.top5_net)}；特定法人前十大 {n0(s.fut_large.top10_net_inst)}</dd>
              </div>
            )}
            {s.fx && (
              <div className="rounded-md bg-surface-2 p-2.5">
                <dt className="text-xs text-muted">美元兌新台幣 <span className={late(s.fx.date)}>{md(s.fx.date)}</span></dt>
                <dd className="font-bold text-ink">{f(s.fx.usd_twd, 3)}</dd>
                <dd className="text-xs text-muted">近 20 日 {s.fx.chg20 == null ? "—" : `${s.fx.chg20 > 0 ? "+" : ""}${f(s.fx.chg20)}%`}（數字變小＝台幣升值）</dd>
              </div>
            )}
          </dl>
          {bl && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 p-2.5 text-sm">
              <span className="text-xs text-muted">景氣對策信號（{bl.latest.month}）</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-ink">
                <span className={`h-3 w-3 rounded-full ${lightOf(bl.latest.score).cls}`} aria-hidden />{bl.latest.light || lightOf(bl.latest.score).name} {f(bl.latest.score, 0)} 分
              </span>
              <span className="flex items-center gap-0.5" aria-label="近 12 個月燈號">
                {bl.series.slice(-12).map((x) => <span key={x.month} title={`${x.month} ${x.score} 分`} className={`h-2.5 w-2.5 rounded-full ${lightOf(x.score).cls}`} />)}
              </span>
              <span className="text-xs text-muted">每月下旬公布；來源：{bl.source}</span>
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">情緒指標描述目前市場氣氛，不預測漲跌；極度貪婪時追價風險較高，極度恐懼時常伴隨大幅波動。台指 VIX 沒有開放 API，以「市場波動」（加權指數實際波動）代替。</p>
    </section>
  );
}
