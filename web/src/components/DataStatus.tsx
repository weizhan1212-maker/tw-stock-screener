import type { Snapshot } from "@/lib/screener";
import { expectedTradingDay } from "@/lib/tradingDay";

export default function DataStatus({ snap, error }: { snap: Snapshot | null; error: string | null }) {
  if (error) return <p className="rounded-lg border border-up/40 bg-surface p-3 text-sm text-up">無法載入資料：{error}</p>;
  if (!snap) return <span className="text-sm text-muted">載入資料中…</span>;
  const expected = expectedTradingDay(snap.meta.holidays);
  const late = snap.meta.asof < expected;
  const md = (d: string) => d.slice(5).replace("-", "/");
  return (
    <>
      {late ? (
        <span className="num rounded-md bg-warn-bg px-2 py-0.5 text-sm text-warn-ink"
          title="每個交易日約 18:45 與 23:30 更新">
          資料日期：{snap.meta.asof.replaceAll("-", "/")}（{md(expected)} 的資料還沒更新，可能資料延遲）
        </span>
      ) : (
        <span className="num text-sm text-muted">最近交易日 {md(snap.meta.asof)}・盤後資料</span>
      )}
      {!snap.meta.fin_complete && (
        <span className="rounded-md bg-warn-bg px-2 py-0.5 text-sm text-warn-ink">財報資料補齊中，基本面條件的結果可能不完整</span>
      )}
    </>
  );
}
