"use client";
/**
 * 資金輪動：題材／產業今天吸引了多少資金（成交占比 vs 平常）、漲跌中位數、法人 5 日動向。
 * 計算在 lib/rotation.ts（AI 市場摘要也用同一份）。
 */
import Link from "next/link";
import { useMemo } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { Seg } from "@/components/Screener";
import { computeRotation, splitFlow, type GroupStat } from "@/lib/rotation";
import type { Row } from "@/lib/screener";

const pct = (v: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const tone = (v: number | null) => (v == null || v === 0 ? "text-muted" : v > 0 ? "text-up" : "text-down");

function Item({ g }: { g: GroupStat }) {
  return (
    <li className="rounded-md border border-line p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{g.name}<span className="ml-1 text-xs font-normal text-muted">{g.n} 檔</span></span>
        <span className={`num text-sm font-bold ${tone(g.chg)}`}>{pct(g.chg)}</span>
      </div>
      <div className="num mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        <span title="今天成交金額占全市場的比例（平常＝20 日平均占比）">成交占比 <b className="font-medium text-ink">{g.share.toFixed(2)}%</b>（平常 {g.share20.toFixed(2)}%，{g.heat.toFixed(2)} 倍）</span>
        <span>5 日 <b className={`font-medium ${tone(g.ret5)}`}>{pct(g.ret5)}</b></span>
        {g.inst5 != null && <span>法人 5 日 <b className={`font-medium ${tone(g.inst5)}`}>{g.inst5 > 0 ? "+" : ""}{g.inst5.toFixed(1)} 億</b></span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {g.leaders.map((s) => (
          <Link key={s.code} href={`/stock/${s.code}`} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink hover:text-accent">
            {s.name} <span className={`num ${tone(s.chg)}`}>{pct(s.chg, 1)}</span>
          </Link>
        ))}
      </div>
    </li>
  );
}

export default function Rotation({ rows, asof }: { rows: Row[]; asof: string }) {
  const [kind, setKind] = useUrlState<"theme" | "ind">("rot", "theme", ["theme", "ind"]);
  const r = useMemo(() => computeRotation(rows), [rows]);
  const { inflow, outflow } = splitFlow(kind === "theme" ? r.themes : r.industries);
  return (
    <section className="mt-3 rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">資金輪動</h2>
        <div className="flex items-center gap-3">
          <Seg label="分類" value={kind} onChange={setKind} options={[["theme", "題材"], ["ind", "產業"]]} />
          <span className="num text-xs text-muted">{asof.slice(5).replace("-", "/")}・每日盤後</span>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {([["資金流入", inflow, "成交占比高於平常、今天中位數上漲"], ["資金退潮", outflow, "成交占比低於平常，或今天明顯下跌"]] as const).map(([title, list, hint]) => (
          <div key={title}>
            <h3 className={`mb-2 text-xs font-bold ${title === "資金流入" ? "text-up" : "text-down"}`}>{title}<span className="ml-2 font-normal text-muted">{hint}</span></h3>
            {list.length ? <ul className="space-y-2">{list.map((g) => <Item key={g.name} g={g} />)}</ul>
              : <p className="text-sm text-muted">今天沒有明顯的{title === "資金流入" ? "流入" : "退潮"}。</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        成交占比＝這一組今天的成交金額 ÷ 全市場普通股成交金額；「倍」＝今天占比 ÷ 20 日平均占比，大於 1 代表今天比平常更多錢在這裡。
        漲跌用組內中位數，不讓單一大型股代表整組。{kind === "theme" ? "題材與代表股由本站整理，只列具代表性的公司。" : "產業依證交所／櫃買中心分類，只列 20 日平均成交占比 0.3% 以上的產業。"}
      </p>
    </section>
  );
}
