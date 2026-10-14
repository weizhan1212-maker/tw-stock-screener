"use client";
/**
 * 題材／產業資金輪動（首頁左下）：依「熱度」排序＝今天成交占比 ÷ 20 日平均占比，越上面代表今天越多錢湧入。
 * 預設顯示 10 組，按「更多」展開全部（區塊內捲動）。計算在 lib/rotation.ts，AI 市場摘要用同一份。
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Seg } from "@/components/Screener";
import { computeRotation } from "@/lib/rotation";
import type { Row } from "@/lib/screener";

const pct = (v: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const tone = (v: number | null) => (v == null || v === 0 ? "text-muted" : v > 0 ? "text-up" : "text-down");

export default function Rotation({ rows, asof }: { rows: Row[]; asof: string }) {
  const [kind, setKind] = useState<"theme" | "ind">("theme");
  const [all, setAll] = useState(false);
  const r = useMemo(() => computeRotation(rows), [rows]);
  const list = kind === "theme" ? r.themes : r.industries;
  const shown = all ? list : list.slice(0, 10);
  const maxHeat = Math.max(2, ...list.map((g) => g.heat));

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">資金輪動</h2>
        <div className="flex items-center gap-3">
          <Seg label="分類" value={kind} onChange={(v) => { setKind(v); setAll(false); }} options={[["theme", "題材"], ["ind", "產業"]]} />
          <span className="num text-xs text-muted">{asof.slice(5).replace("-", "/")}・每日盤後</span>
        </div>
      </div>
      <div className="num grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] gap-2 border-b border-line pb-1 text-[11px] text-muted sm:grid-cols-[9rem_11rem_4.5rem_4.5rem_minmax(0,1fr)]">
        <span>{kind === "theme" ? "題材" : "產業"}</span>
        <span className="hidden sm:block" title="今天成交占比 ÷ 20 日平均占比；1 倍＝跟平常一樣">熱度（對平常）</span>
        <span className="text-right">漲跌中位數</span>
        <span className="text-right">法人 5 日</span>
        <span className="hidden sm:block">今天漲最多</span>
      </div>
      <ul className={`divide-y divide-line ${all ? "max-h-[520px] overflow-y-auto" : ""}`}>
        {shown.map((g) => (
          <li key={g.name} className="num grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] items-center gap-2 py-1.5 text-sm sm:grid-cols-[9rem_11rem_4.5rem_4.5rem_minmax(0,1fr)]">
            <span className="truncate text-ink" title={`${g.name}（${g.n} 檔）`}>{g.name}<span className="ml-1 text-[11px] text-muted sm:hidden">{g.heat.toFixed(1)}倍</span></span>
            <span className="hidden items-center gap-2 sm:flex">
              <span className="relative h-2 flex-1 rounded-full bg-surface-2">
                <span className="absolute inset-y-0 w-px bg-muted/50" style={{ left: `${(1 / maxHeat) * 100}%` }} aria-hidden />
                <span className={`block h-full rounded-full ${g.heat >= 1 ? "bg-up" : "bg-down"}`} style={{ width: `${Math.min(100, (g.heat / maxHeat) * 100)}%` }} />
              </span>
              <span className="w-10 text-right text-xs text-ink">{g.heat.toFixed(2)}倍</span>
            </span>
            <span className={`text-right ${tone(g.chg)}`}>{pct(g.chg)}</span>
            <span className={`text-right text-xs ${tone(g.inst5)}`}>{g.inst5 == null ? "—" : `${g.inst5 > 0 ? "+" : ""}${g.inst5.toFixed(1)}億`}</span>
            <span className="hidden truncate text-xs sm:block">
              {g.leaders.slice(0, 3).map((s, i) => (
                <Link key={s.code} href={`/stock/${s.code}`} className="text-ink hover:text-accent">
                  {i > 0 && "、"}{s.name}<span className={tone(s.chg)}>{pct(s.chg, 1)}</span>
                </Link>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {list.length > 10 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 w-full rounded-md border border-line py-1.5 text-sm text-accent hover:bg-surface-2">
          {all ? "收起" : `更多（共 ${list.length} 組）`}
        </button>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        熱度＝這一組今天的成交金額占全市場的比例 ÷ 它 20 日平均的占比，大於 1 倍代表今天比平常更多錢在這裡（紅），小於 1 倍代表資金退潮（綠）。
        漲跌用組內中位數，不讓單一大型股代表整組。{kind === "theme" ? "題材與代表股由本站整理。" : "產業只列 20 日平均成交占比 0.3% 以上的。"}只描述現況，不預測漲跌。
      </p>
    </section>
  );
}
