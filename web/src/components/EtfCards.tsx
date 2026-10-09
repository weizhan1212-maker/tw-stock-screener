"use client";
/**
 * ETF 專屬區塊：
 * - 選股方式：證交所基金基本資料（類型、追蹤指數或績效指標、經理人…）翻成白話
 * - 折溢價：證交所 ETF 淨值表（市價 vs 投信預估淨值），近 120 個交易日
 * - 成分股：投信投顧公會每月公布的前十大持股
 * - 個股頁「被哪些 ETF 列入前十大」
 */
import Link from "next/link";
import Section from "@/components/Section";
import { num, type Row } from "@/lib/screener";
import type { StockFile } from "@/lib/stock";

const f = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${f(v, d)}%`);
const ymText = (ym: string) => `${ym.slice(0, 4)}/${ym.slice(4)}`;
const has = (v?: string) => !!v && v !== "不適用" && v !== "—";

// ---------------- 選股方式 ----------------

export function EtfMethodCard({ s, row }: { s: StockFile | null; row: Row | null }) {
  const i = s?.etf?.info;
  const type = i?.etf_type || (row?.etf_type as string) || "";
  const index = i?.etf_index || (row?.etf_index as string) || "";
  const active = /主動/.test(type) || /A$/.test(s?.code ?? "");
  const lev = /槓桿|反向/.test(type) || /[LR]$/.test(s?.code ?? "");
  const bond = /債/.test(type) || /B$/.test(s?.code ?? "");
  let plain: string;
  if (active) plain = `主動式 ETF：沒有固定的指數規則，由經理人自己挑選股票、隨時調整持股${has(i?.etf_benchmark) ? `；績效拿來跟「${i!.etf_benchmark}」比較` : ""}。`;
  else if (lev) plain = `槓桿／反向型 ETF：用期貨等工具追求「${index || "標的指數"}」單日報酬的倍數或反向，適合短線，長期持有會因每日重設而偏離。`;
  else if (has(index)) plain = `指數型（被動式）ETF：照「${index}」的成分股與權重買進，指數換股時 ETF 跟著換；選股規則由指數公司訂定。${i?.etf_custom_index === "是" ? "這是客製化指數，規則由投信與指數公司約定，細節請看公開說明書。" : ""}`;
  else plain = "資料來源沒有提供這檔 ETF 的追蹤指數。";
  const items: [string, string][] = [
    ["類型", type || "—"],
    [active ? "績效指標" : "追蹤指數", (active ? i?.etf_benchmark : index) || "—"],
    ["含國外成分股", i?.etf_foreign || "—"],
    ["經理人", i?.etf_manager || "—"],
    ["成立日", i?.etf_founded || "—"],
    ["上市日", i?.etf_listed || (row?.etf_listed as string) || "—"],
  ];
  return (
    <Section id="etf-method" title="選股方式" note="來源：證交所基金基本資料">
      <p className="mb-3 rounded-md bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink">{plain}{bond && !active ? "（債券型：成分是債券，不是股票。）" : ""}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {items.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>)}
      </dl>
      {has(i?.etf_mix) && <p className="mt-2 text-xs text-muted">投資比例：{i!.etf_mix}</p>}
    </Section>
  );
}

// ---------------- 折溢價 ----------------

function PremiumBars({ d, v }: { d: string[]; v: (number | null)[] }) {
  const xs = v.map((x) => x ?? 0);
  const max = Math.max(0.3, ...xs.map(Math.abs));
  const w = 600, h = 90, bw = w / Math.max(xs.length, 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="每日折溢價">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="stroke-line" strokeWidth="1" />
      {xs.map((x, i) => {
        const bh = (Math.abs(x) / max) * (h / 2 - 2);
        return <rect key={d[i]} x={i * bw + 0.5} width={Math.max(bw - 1, 1)} y={x >= 0 ? h / 2 - bh : h / 2} height={bh}
          className={x >= 0 ? "fill-up" : "fill-down"}><title>{`${d[i]} ${pct(x)}`}</title></rect>;
      })}
    </svg>
  );
}

export function EtfPremiumCard({ s }: { s: StockFile | null }) {
  const n = s?.etf?.nav;
  if (!n || !n.d.length) {
    return (
      <Section id="etf-premium" title="折溢價" note="來源：證交所 ETF 淨值表">
        <p className="text-sm text-muted">還沒有這檔 ETF 的淨值資料（每天盤後更新，從本功能上線起累積）。</p>
      </Section>
    );
  }
  const k = n.d.length - 1;
  const last = n.pr[k];
  const prs = n.pr.filter((x): x is number => x != null);
  const avg = prs.length ? prs.reduce((a, b) => a + b, 0) / prs.length : null;
  const u0 = n.u.find((x) => x != null) ?? null, u1 = n.u[k];
  const uChg = u0 && u1 ? ((u1 / u0) - 1) * 100 : null;
  const tone = last == null ? "text-ink" : last > 0.5 ? "text-up" : last < -0.5 ? "text-down" : "text-ink";
  return (
    <Section id="etf-premium" title="折溢價" note={`來源：證交所 ETF 淨值表；資料日 ${n.d[k]}`}>
      <dl className="num grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
        <div><dt className="text-xs text-muted">市價</dt><dd className="text-ink">{f(n.p[k])}</dd></div>
        <div><dt className="text-xs text-muted">投信預估淨值</dt><dd className="text-ink">{f(n.n[k])}</dd></div>
        <div><dt className="text-xs text-muted">折溢價</dt><dd className={`font-bold ${tone}`}>{pct(last)}</dd></div>
        <div><dt className="text-xs text-muted">近 {prs.length} 日平均</dt><dd className="text-ink">{pct(avg)}</dd></div>
        <div><dt className="text-xs text-muted" title="發行單位數變化：增加代表有資金申購、減少代表贖回">發行單位變化（{n.d.length} 日）</dt><dd className="text-ink">{pct(uChg, 1)}</dd></div>
      </dl>
      {n.d.length >= 5 && <div className="mt-3"><PremiumBars d={n.d} v={n.pr} /></div>}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        折溢價＝（市價 − 預估淨值）÷ 預估淨值。溢價（紅）代表市價比 ETF 實際價值貴，常見於熱門 ETF 或額度用完暫停申購時；
        溢價超過 1% 時買進要小心，價格可能回到淨值附近。
      </p>
    </Section>
  );
}

// ---------------- 成分股 ----------------

export function EtfHoldingsCard({ s }: { s: StockFile | null }) {
  const t = s?.etf?.top10;
  if (!t || !t.rows.length) {
    return (
      <Section id="etf-holdings" title="成分股（前十大）" note="來源：投信投顧公會">
        <p className="text-sm text-muted">公會的月前十大資料目前只抓國內股票型 ETF（指數型與主動式）；債券、海外、槓桿反向型暫不提供。</p>
      </Section>
    );
  }
  const total = t.rows.reduce((a, r) => a + (r.pct ?? 0), 0);
  const max = Math.max(...t.rows.map((r) => r.pct ?? 0), 1);
  return (
    <Section id="etf-holdings" title="成分股（前十大）" note={`來源：投信投顧公會（資料來源為各投信），${ymText(t.ym)} 月底`}>
      <table className="num w-full text-sm">
        <thead><tr className="text-xs text-muted"><th className="py-1.5 text-left font-normal">名次</th><th className="text-left font-normal">股票</th>
          <th className="w-[40%] font-normal" /><th className="text-right font-normal">占淨值</th><th className="hidden text-right font-normal sm:table-cell">金額（億）</th></tr></thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={`${r.code}-${i}`} className="border-t border-line">
              <td className="py-1.5 text-muted">{i + 1}</td>
              <td>{/^\d{4,6}[A-Z]?$/.test(r.code) ? <Link href={`/stock/${r.code}`} className="text-ink hover:text-accent">{r.name} <span className="text-xs text-muted">{r.code}</span></Link> : <span className="text-ink">{r.name}</span>}</td>
              <td className="px-2"><div className="h-2 rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${((r.pct ?? 0) / max) * 100}%` }} /></div></td>
              <td className="text-right text-ink">{f(r.pct)}%</td>
              <td className="hidden text-right text-muted sm:table-cell">{r.amt == null ? "—" : f(r.amt / 1e8, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">前十大合計占淨值 {f(total)}%。公會每月公布一次（約晚一個多月），完整持股與每日異動請看發行投信官網。</p>
    </Section>
  );
}

// ---------------- 個股：被哪些 ETF 持有 ----------------

export function HeldByEtfCard({ s }: { s: StockFile | null }) {
  const h = s?.held_by;
  if (!h || !h.length) return null;
  const ym = h[0].ym;
  return (
    <Section id="held-by" title={`列入前十大持股的 ETF（${h.length} 檔）`} note={`來源：投信投顧公會月前十大，${ymText(ym)} 月底`}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {h.map((x) => (
          <li key={x.etf}>
            <Link href={`/stock/${x.etf}`} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm hover:border-accent">
              <span className="min-w-0 truncate text-ink">{x.name}<span className="ml-1 text-xs text-muted">{x.etf}</span></span>
              <span className="num shrink-0 text-right"><span className="font-medium text-ink">{f(x.pct)}%</span><span className="ml-1 text-xs text-muted">第 {x.rank} 名</span></span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">只列出把這檔股票放在前十大的國內股票型 ETF；排在第 11 名以後的 ETF 不會出現在這裡。</p>
    </Section>
  );
}

/** ETF 標頭的重點數字 */
export function etfHeadline(row: Row): [string, string][] {
  const v = (k: string) => num(row[k]);
  return [
    ["規模（估算）", v("etf_aum") == null ? "—" : `${f(v("etf_aum"), 0)} 億`],
    ["折溢價", pct(v("etf_premium"))],
    ["預估淨值", f(v("etf_nav"))],
    ["殖利率（近一年）", v("dividend_yield") == null ? "—" : `${f(v("dividend_yield"))}%`],
    ["近一年配息", v("etf_div12m") == null ? "—" : `${f(v("etf_div12m"))} 元`],
  ];
}
