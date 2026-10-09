"use client";
/**
 * 個股頁「AI 摘要」：按下按鈕才產生；同一檔同一個資料日只產生一次，全站共用。
 * 只描述事實，不給買賣建議。伺服器沒設定金鑰時整張卡片不顯示。
 */
import { useCallback, useEffect, useState } from "react";
import Section from "@/components/Section";

interface Summary {
  code: string; name: string; asof: string; generatedAt: string; model: string;
  headline: string; sections: { key: string; title: string; text: string }[]; overall: string;
}
interface State { enabled: boolean; cached: Summary | null; used: number; limit: number }

const when = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export default function AiSummaryCard({ code, asof }: { code: string; asof: string }) {
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; detail?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ai/stock?code=${code}&asof=${asof}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j && setSt(j as State))
      .catch(() => {});
    return () => { alive = false; };
  }, [code, asof]);

  const generate = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/ai/stock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const j = await r.json();
      if (!r.ok) { setErr({ msg: j.error ?? `產生失敗（${r.status}）`, detail: j.detail }); return; }
      setSt((p) => ({ enabled: true, cached: j.summary as Summary, used: j.used, limit: j.limit ?? p?.limit ?? 0 }));
    } catch {
      setErr({ msg: "網路不穩，請稍後再試" });
    } finally {
      setBusy(false);
    }
  }, [code]);

  if (!st?.enabled) return null;
  const s = st.cached;
  return (
    <Section id="ai" title="AI 摘要" note="由 AI 整理本頁資料，只描述事實，不是投資建議">
      {s ? (
        <div className="space-y-3 text-sm leading-relaxed">
          <p className="text-base font-bold text-ink">{s.headline}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {s.sections.map((x) => (
              <div key={x.key} className="rounded-md border border-line bg-surface-2 p-3">
                <div className="mb-1 text-xs font-bold text-accent">{x.title}</div>
                <p className="text-ink">{x.text}</p>
              </div>
            ))}
          </div>
          <p className="text-ink">{s.overall}</p>
          <p className="num text-xs text-muted">
            資料日 {s.asof.replaceAll("-", "/")}・產生於 {when(s.generatedAt)}・{s.model}・同一檔同一天只產生一次，大家共用
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={generate} disabled={busy || st.used >= st.limit}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "整理中…（約 5–15 秒）" : "產生 AI 摘要"}
          </button>
          <span className="text-xs text-muted">
            今天已用 {st.used}／{st.limit} 次（已有人產生過的摘要不扣次數）
          </span>
        </div>
      )}
      {err && (
        <p className="mt-2 text-sm text-up">
          {err.msg}
          {err.detail && <span className="mt-1 block break-all text-xs text-muted">（管理員除錯）{err.detail}</span>}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">AI 生成內容僅供參考，不構成任何投資建議；數字取自本站資料，仍請自行核對。</p>
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none hover:text-ink">資料說明</summary>
        <div className="mt-1 space-y-1 leading-relaxed">
          <p>使用的資料：盤後價量與估值、技術指標與短中長線狀態、財務健康評級與同產業排名、近 6 個月營收年增率、近 4 季財報、三大法人／融資券／外資持股／集保大戶、全市場排名、近期重大訊息與法說會。</p>
          <p>不使用：新聞、預測、他人持倉或自選股。AI 只負責把上述數字寫成文字；產生後會自動檢查，數字必須出現在上述資料中，且不得含買賣建議，沒通過就不顯示。</p>
          <p>籌碼資料在傍晚可能比價格晚一天，詳見各欄位上的「T-1」標記。</p>
        </div>
      </details>
    </Section>
  );
}
