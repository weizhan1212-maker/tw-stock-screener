import type { Snapshot } from "@/lib/screener";

/** 依台灣時間推算「應該要有」的最新資料日（平日 18:00 後算當天），比它舊就提醒。 */
function isLate(asof: string): boolean {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const d = new Date(now);
  if (now.getHours() < 18) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return asof < expected;
}

export default function DataStatus({ snap, error }: { snap: Snapshot | null; error: string | null }) {
  if (error) return <p className="rounded-lg border border-up/40 bg-surface p-3 text-sm text-up">無法載入資料：{error}</p>;
  if (!snap) return <span className="text-sm text-muted">載入資料中…</span>;
  const late = isLate(snap.meta.asof);
  return (
    <>
      <span className={`num rounded-md px-2 py-0.5 text-sm ${late ? "bg-warn-bg text-warn-ink" : "text-muted"}`}>
        資料日期：{snap.meta.asof.replaceAll("-", "/")}
        {late && "（今日資料尚未更新，可能休市或資料延遲）"}
      </span>
      {!snap.meta.fin_complete && (
        <span className="rounded-md bg-warn-bg px-2 py-0.5 text-sm text-warn-ink">財報資料補齊中，基本面條件的結果可能不完整</span>
      )}
    </>
  );
}
