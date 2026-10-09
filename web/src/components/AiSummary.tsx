"use client";
/**
 * 個股頁「AI 解讀」：按下按鈕才產生；同一檔同一個資料日只產生一次，全站共用。
 * 五因子體檢由伺服器計算（不經過 AI）；AI 負責歸納看多理由、主要風險、觀察條件與追蹤重點。
 * 不給買賣建議。伺服器沒設定金鑰時整張卡片不顯示。
 */
import { useCallback, useEffect, useState } from "react";
import Section from "@/components/Section";

interface Point { title: string; text: string }
interface Factor { key: string; label: string; pct: number | null; basis: string }
interface Summary {
  v: 2; code: string; name: string; asof: string; generatedAt: string; model: string; factors: Factor[];
  positioning: string; headline: string; bulls: Point[]; risks: Point[]; change: string; watch: string[];
}
interface State { enabled: boolean; cached: Summary | null; used: number; limit: number }

const when = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function Bar({ f }: { f: Factor }) {
  const p = f.pct;
  return (
    <div className="grid grid-cols-[2.5rem_1fr_5.5rem] items-center gap-2 text-xs" title={`依${f.basis}`}>
      <span className="font-medium text-ink">{f.label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        {p != null && <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(p, 2)}%` }} />}
      </div>
      <span className="num text-right text-muted">{p == null ? "資料不足" : `贏過 ${p}%`}</span>
    </div>
  );
}

function Points({ title, items, tone }: { title: string; items: Point[]; tone: "up" | "down" }) {
  return (
    <div className="rounded-md border border-line p-3">
      <div className={`mb-2 text-sm font-bold ${tone === "up" ? "text-up" : "text-down"}`}>{title}</div>
      <ol className="space-y-2.5">
        {items.map((x, i) => (
          <li key={i} className="text-sm leading-relaxed">
            <div className="font-medium text-ink">{i + 1}. {x.title}</div>
            <p className="text-ink/85">{x.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

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
  const s = st.cached?.v === 2 ? st.cached : null;
  return (
    <Section id="ai" title="AI 解讀" note="由 AI 根據本站資料歸納，不是投資建議">
      {s ? (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {s.positioning.split(/[、，,]/).map((t) => t.trim()).filter(Boolean).map((t) => (
                <span key={t} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{t}</span>
              ))}
            </div>
            <p className="text-base font-bold leading-snug text-ink">{s.headline}</p>
          </div>

          {s.factors?.some((f) => f.pct != null) && (
            <div className="rounded-md bg-surface-2/60 p-3">
              <div className="mb-2 text-xs text-muted">五因子體檢</div>
              <div className="space-y-1.5">{s.factors.map((f) => <Bar key={f.key} f={f} />)}</div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <Points title="看多理由" items={s.bulls} tone="up" />
            <Points title="主要風險" items={s.risks} tone="down" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-line p-3 text-sm leading-relaxed">
              <div className="mb-1 font-bold text-ink">什麼情況代表故事變了</div>
              <p className="text-ink/85">{s.change}</p>
            </div>
            <div className="rounded-md border border-line p-3 text-sm leading-relaxed">
              <div className="mb-1 font-bold text-ink">接下來追蹤</div>
              <ul className="list-disc space-y-0.5 pl-5 text-ink/85">{s.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          </div>

          <p className="num text-xs text-muted">
            資料日 {s.asof.replaceAll("-", "/")}・產生於 {when(s.generatedAt)}・{s.model}・同一檔同一天只產生一次，大家共用
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={generate} disabled={busy || st.used >= st.limit}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "分析中…（約 10–30 秒）" : "產生 AI 解讀"}
          </button>
          <span className="text-xs text-muted">
            今天已用 {st.used}／{st.limit} 次（已有人產生過的不扣次數）
          </span>
        </div>
      )}
      {err && (
        <p className="mt-2 text-sm text-up">
          {err.msg}
          {err.detail && <span className="mt-1 block break-all text-xs text-muted">（管理員除錯）{err.detail}</span>}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">AI 生成內容僅供參考，不構成任何投資建議；不提供買賣點、目標價或停損。數字取自本站資料，仍請自行核對。</p>
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none hover:text-ink">資料說明</summary>
        <div className="mt-1 space-y-1 leading-relaxed">
          <p>使用的資料：盤後價量與估值、技術指標、近幾季財報與月營收、股利、三大法人／融資券／外資持股／集保大戶、全市場排名、近期重大訊息與法說會。</p>
          <p>比較對象由本站計算：五因子全市場百分位、同產業與全市場中位數、最新月營收在自己近 3 年的位置。</p>
          <p>不使用：新聞、法人預估、他人持倉或自選股。產生後會自動檢查：數字必須出現在上述資料中、不得含買賣字眼，沒通過就不顯示。</p>
          <p>籌碼資料在傍晚可能比價格晚一天，詳見各欄位上的「T-1」標記。</p>
        </div>
      </details>
    </Section>
  );
}
