"use client";

/** 個股頁的盤中即時區塊：開高低、均價、量、金額、最佳五檔。資料來源富果。 */
import type { LiveQuote } from "@/lib/fugle";

const f = (x: number | null | undefined, d = 2) =>
  x == null ? "—" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
const pd = (x: number | null) => (x != null && x >= 1000 ? 0 : 2);

export function liveLabel(q: LiveQuote) {
  if (q.isClose) return "今日收盤";
  if (q.isTrial) return "試撮";
  const t = q.time ? new Date(q.time).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "";
  return `即時 ${t}`;
}

export default function LivePanel({ q }: { q: LiveQuote }) {
  const d = pd(q.price);
  const cls = (p: number | null) => (p == null || q.ref == null || p === q.ref ? "text-ink" : p > q.ref ? "text-up" : "text-down");
  const maxSize = Math.max(1, ...q.bids.map((b) => b.size), ...q.asks.map((a) => a.size));
  const bar = (s: number) => `${Math.round((s / maxSize) * 100)}%`;
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-ink">盤中即時</h2>
        <span className="text-xs text-muted">{liveLabel(q)}・{q.date.replaceAll("-", "/")}・資料來源：富果（免費額度大家共用，更新可能稍慢）</span>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_minmax(260px,340px)]">
        <dl className="num grid grid-cols-3 content-start gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {([
            ["開盤", q.open, cls(q.open)], ["最高", q.high, cls(q.high)], ["最低", q.low, cls(q.low)],
            ["均價", q.avg, cls(q.avg)], ["參考價", q.ref, "text-ink"],
          ] as const).map(([k, v, c]) => (
            <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className={c}>{f(v, d)}</dd></div>
          ))}
          <div><dt className="text-xs text-muted">成交量</dt><dd className="text-ink">{f(q.volLots, 0)} 張</dd></div>
          <div><dt className="text-xs text-muted">成交金額</dt><dd className="text-ink">{q.value == null ? "—" : `${f(q.value / 1e8)} 億`}</dd></div>
          {(q.limitUp || q.limitDown) && (
            <div><dt className="text-xs text-muted">狀態</dt><dd className={q.limitUp ? "text-up" : "text-down"}>{q.limitUp ? "漲停" : "跌停"}</dd></div>
          )}
        </dl>
        {(q.bids.length > 0 || q.asks.length > 0) && (
          <div>
            <p className="mb-1 text-xs text-muted">最佳五檔（張）：左邊是想買的人出的價，右邊是想賣的人出的價</p>
            <table className="num w-full text-sm">
              <thead><tr className="text-xs text-muted"><th className="text-left font-normal">委買量</th><th className="text-right font-normal">買價</th><th className="pl-3 text-left font-normal">賣價</th><th className="text-right font-normal">委賣量</th></tr></thead>
              <tbody>
                {Array.from({ length: 5 }, (_, i) => {
                  const b = q.bids[i], a = q.asks[i];
                  return (
                    <tr key={i}>
                      <td className="relative py-0.5">
                        {b && <span className="absolute inset-y-0.5 right-0 bg-up/15" style={{ width: bar(b.size) }} />}
                        <span className="relative">{b ? f(b.size, 0) : ""}</span>
                      </td>
                      <td className={`text-right ${b ? cls(b.price) : ""}`}>{b ? f(b.price, d) : ""}</td>
                      <td className={`pl-3 ${a ? cls(a.price) : ""}`}>{a ? f(a.price, d) : ""}</td>
                      <td className="relative text-right">
                        {a && <span className="absolute inset-y-0.5 left-0 bg-down/15" style={{ width: bar(a.size) }} />}
                        <span className="relative">{a ? f(a.size, 0) : ""}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
