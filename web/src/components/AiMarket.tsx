"use client";
/**
 * 首頁最上方「AI 市場摘要」：每次盤後資料更新後，第一個打開的人自動產生，全站共用。
 * 一句話快訊＋今天的市場氣氛；展開看大盤、籌碼、資金輪動與接下來留意的事。不給買賣建議。
 */
import { useEffect, useState } from "react";

interface Summary {
  tone: string; headline: string; summary: string; points: { title: string; text: string }[]; rotation: string; watch: string[];
  asof: string; generatedAt: string; model: string;
}

const TONE: Record<string, string> = { 偏多: "bg-up/10 text-up", 偏空: "bg-down/10 text-down", 中性: "bg-surface-2 text-muted" };
const when = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export default function AiMarket() {
  const [s, setS] = useState<Summary | null>(null);
  const [state, setState] = useState<"loading" | "off" | "working" | "ready" | "error">("loading");
  const [err, setErr] = useState<{ msg: string; detail?: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      try {
        const g = await fetch("/api/ai/market").then((r) => r.json());
        if (!alive) return;
        if (!g.enabled) { setState("off"); return; }
        if (g.summary) { setS(g.summary); setState("ready"); return; }
        setState("working");
        for (let i = 0; i < 12 && alive; i++) {
          const r = await fetch("/api/ai/market", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          const j = await r.json();
          if (!alive) return;
          if (r.ok && j.summary) { setS(j.summary); setState("ready"); return; }
          if (r.status !== 202) { setErr({ msg: j.error ?? "AI 摘要暫時無法產生", detail: j.detail }); setState("error"); return; }
          await sleep(8000);                               // 別人正在產生，等一下再問
        }
        if (alive) { setErr({ msg: "AI 摘要還在整理中，請稍後重新整理頁面" }); setState("error"); }
      } catch {
        if (alive) { setErr({ msg: "網路不穩，AI 摘要暫時讀不到" }); setState("error"); }
      }
    })();
    return () => { alive = false; };
  }, []);

  if (state === "off" || state === "loading") return null;
  return (
    <section className="mt-3 rounded-lg border border-line bg-surface px-4 py-3">
      {/* 收合時只有一行：標籤、氣氛、一句話重點、展開 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent">AI 市場摘要</span>
        {s && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[s.tone] ?? TONE["中性"]}`}>{s.asof.slice(5).replace("-", "/")} {s.tone}</span>}
        {s && <span className="min-w-0 flex-1 text-sm font-medium text-ink">{s.headline}</span>}
        {s && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="shrink-0 text-sm text-accent hover:underline">
            {open ? "收起" : "展開"}
          </button>
        )}
        {state === "working" && <span className="text-sm text-muted">AI 正在整理最近交易日的市場…（約 15–30 秒）</span>}
        {state === "error" && err && <span className="text-sm text-muted">{err.msg}{err.detail && <span className="ml-1 break-all text-xs">（管理員除錯）{err.detail}</span>}</span>}
      </div>
      {s && open && (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-relaxed text-ink/85">{s.summary}</p>
          <div className="rounded-md bg-surface-2/60 p-3">
            <div className="mb-1 text-xs font-bold text-ink">資金輪動</div>
            <p className="text-sm leading-relaxed text-ink/85">{s.rotation}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {s.points.map((p) => (
              <div key={p.title} className="rounded-md border border-line p-3 text-sm leading-relaxed">
                <div className="mb-1 font-bold text-ink">{p.title}</div>
                <p className="text-ink/85">{p.text}</p>
              </div>
            ))}
            <div className="rounded-md border border-line p-3 text-sm leading-relaxed md:col-span-3">
              <div className="mb-1 font-bold text-ink">接下來留意</div>
              <ul className="list-disc space-y-0.5 pl-5 text-ink/85">{s.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          </div>
          <p className="num text-xs text-muted">資料日 {s.asof.replaceAll("-", "/")}・產生於 {when(s.generatedAt)}・{s.model}・AI 生成，僅供參考，不構成投資建議</p>
        </div>
      )}
    </section>
  );
}
