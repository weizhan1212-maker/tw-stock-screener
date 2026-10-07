"use client";

/** 投資組合與持倉管理：手動輸入成本、持有理由、預期期間、目標價與失效價；計算損益、風險額度、同期大盤、績效歸因。 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import DataStatus from "@/components/DataStatus";
import { NumInput } from "@/components/Screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import { num, type Row } from "@/lib/screener";
import { todayStr } from "@/lib/stock";

export interface Position {
  id: string; code: string; shares: number; cost: number; date: string;
  reason?: string; horizon?: string; target?: number | null; stop?: number | null; note?: string;
}
interface Pf { id: string; name: string; positions: Position[] }

const HORIZONS = ["短線（數週）", "波段（數月）", "長期（一年以上）"];
const uid = () => Math.random().toString(36).slice(2, 10);
const f = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${f(x, d)}`);
const tone = (x: number | null | undefined) => (x == null || Math.abs(x) < 1e-9 ? "text-ink" : x > 0 ? "text-up" : "text-down");

type Series = { d: string[]; c: (number | null)[] };

export default function Portfolio() {
  const { snap, error } = useSnapshot();
  const [pfs, setPfs] = useState<Pf[] | null>(null);
  const [cur, setCur] = useState(0);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<Position | null>(null);
  const [taiex, setTaiex] = useState<Series | null>(null);

  useEffect(() => {
    fetch("/api/me/portfolio").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPfs(j.portfolios?.length ? j.portfolios : [{ id: uid(), name: "我的組合", positions: [] }]);
    }).catch((e) => { setMsg(`讀取失敗：${e.message}`); setPfs([{ id: uid(), name: "我的組合", positions: [] }]); });
    fetch("/api/indices").then((r) => (r.ok ? r.json() : null)).then((j) => setTaiex(j?.series?.["發行量加權股價指數"] ?? null)).catch(() => {});
  }, []);

  async function save(next: Pf[]) {
    const prev = pfs;
    setPfs(next);
    const r = await fetch("/api/me/portfolio", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ portfolios: next }) });
    if (!r.ok) { setPfs(prev); setMsg(`儲存失敗：HTTP ${r.status}`); } else setMsg("");
  }

  const by = useMemo(() => new Map((snap?.rows ?? []).map((r) => [r.code as string, r])), [snap]);
  const pf = pfs?.[Math.min(cur, (pfs?.length ?? 1) - 1)];

  function upsert(p: Position) {
    if (!pfs || !pf) return;
    const exists = pf.positions.some((x) => x.id === p.id);
    const positions = exists ? pf.positions.map((x) => (x.id === p.id ? p : x)) : [...pf.positions, p];
    save(pfs.map((x) => (x.id === pf.id ? { ...x, positions } : x)));
    setEditing(null);
  }
  function remove(id: string) {
    if (!pfs || !pf) return;
    save(pfs.map((x) => (x.id === pf.id ? { ...x, positions: x.positions.filter((p) => p.id !== id) } : x)));
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink">投資組合</h1>
        <DataStatus snap={snap} error={error} />
      </div>
      <p className="mt-1 text-sm text-muted">手動記錄持股，不連結券商。現價用最新收盤價；只有你自己看得到。</p>
      {msg && <p className="mt-2 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">{msg}</p>}

      {pfs && pf && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {pfs.map((p, i) => (
              <button key={p.id} type="button" onClick={() => { setCur(i); setEditing(null); }}
                className={`rounded-md border px-3 py-1.5 text-sm ${p.id === pf.id ? "border-accent bg-accent-soft text-accent" : "border-line text-ink hover:border-accent"}`}>
                {p.name}<span className="ml-1 text-xs text-muted">{p.positions.length}</span>
              </button>
            ))}
            {pfs.length < 10 && (
              <button type="button" className="rounded-md border border-dashed border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
                onClick={() => { const name = window.prompt("新組合名稱", `組合 ${pfs.length + 1}`)?.trim().slice(0, 30); if (name) { save([...pfs, { id: uid(), name, positions: [] }]); setCur(pfs.length); } }}>
                ＋ 新組合
              </button>
            )}
            <button type="button" className="ml-auto text-xs text-muted hover:text-ink"
              onClick={() => { const name = window.prompt("組合名稱", pf.name)?.trim().slice(0, 30); if (name) save(pfs.map((x) => (x.id === pf.id ? { ...x, name } : x))); }}>改名</button>
            {pfs.length > 1 && (
              <button type="button" className="text-xs text-muted hover:text-up"
                onClick={() => { if (window.confirm(`刪除「${pf.name}」和裡面 ${pf.positions.length} 筆持倉？`)) { save(pfs.filter((x) => x.id !== pf.id)); setCur(0); } }}>刪除組合</button>
            )}
          </div>

          <Summary pf={pf} by={by} taiex={taiex} />

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Holdings pf={pf} by={by} onEdit={setEditing} onRemove={remove} />
            <PositionForm key={editing?.id ?? "new"} init={editing} by={by} onSave={upsert} onCancel={() => setEditing(null)} />
          </div>
        </>
      )}
      {!pfs && <p className="mt-4 text-sm text-muted">載入中…</p>}
    </div>
  );
}

interface Calc { p: Position; row?: Row; price: number | null; value: number | null; costAmt: number; pnl: number | null; ret: number | null; risk: number | null; bench: number | null }

function calc(pf: Pf, by: Map<string, Row>, taiex: Series | null): Calc[] {
  const at = (date: string) => {
    if (!taiex) return null;
    let v: number | null = null;
    for (let i = 0; i < taiex.d.length && taiex.d[i] <= date; i++) if (taiex.c[i] != null) v = taiex.c[i];
    return v;
  };
  const last = taiex ? [...taiex.c].reverse().find((x) => x != null) ?? null : null;
  return pf.positions.map((p) => {
    const row = by.get(p.code);
    const price = num(row?.close);
    const value = price != null ? price * p.shares : null;
    const costAmt = p.cost * p.shares;
    const pnl = value != null ? value - costAmt : null;
    const t0 = at(p.date);
    return {
      p, row, price, value, costAmt, pnl, ret: pnl != null ? (pnl / costAmt) * 100 : null,
      risk: price != null && p.stop ? Math.max(0, price - p.stop) * p.shares : null,
      bench: t0 && last ? (last / t0 - 1) * 100 : null,
    };
  });
}

function Summary({ pf, by, taiex }: { pf: Pf; by: Map<string, Row>; taiex: Series | null }) {
  const c = calc(pf, by, taiex);
  if (!c.length) return null;
  const value = c.reduce((a, x) => a + (x.value ?? x.costAmt), 0);
  const cost = c.reduce((a, x) => a + x.costAmt, 0);
  const pnl = value - cost;
  const benchW = c.filter((x) => x.bench != null);
  const bench = benchW.length ? benchW.reduce((a, x) => a + x.bench! * x.costAmt, 0) / benchW.reduce((a, x) => a + x.costAmt, 0) : null;
  const risk = c.reduce((a, x) => a + (x.risk ?? 0), 0);
  const noStop = c.filter((x) => !x.p.stop).length;
  const ind = new Map<string, number>();
  for (const x of c) { const k = (x.row?.ind as string) || (x.row?.sec_type === "etf" ? "ETF" : "其他"); ind.set(k, (ind.get(k) ?? 0) + (x.value ?? x.costAmt)); }
  const indList = [...ind].sort((a, b) => b[1] - a[1]);
  const contrib = [...c].filter((x) => x.pnl != null).sort((a, b) => b.pnl! - a.pnl!);

  return (
    <div className="mt-4 space-y-3">
      <dl className="num grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="目前市值" value={`${f(value, 0)} 元`} />
        <Card label="投入成本" value={`${f(cost, 0)} 元`} />
        <Card label="未實現損益" value={`${sgn(pnl, 0)} 元`} cls={tone(pnl)} />
        <Card label="報酬率" value={`${sgn((pnl / cost) * 100)}%`} cls={tone(pnl)} sub={bench == null ? undefined : `同期加權指數 ${sgn(bench)}%`} />
        <Card label="風險額度（跌到失效價）" value={`${f(risk, 0)} 元`} sub={`占市值 ${f((risk / value) * 100, 1)}%${noStop ? `・${noStop} 筆未設失效價` : ""}`} />
        <Card label="持股數" value={`${c.length} 筆`} sub={`最大一筆占 ${f((Math.max(...c.map((x) => x.value ?? x.costAmt)) / value) * 100, 0)}%`} />
      </dl>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-3 text-sm">
          <h3 className="font-bold text-ink">產業分布</h3>
          <ul className="mt-2 space-y-1.5">
            {indList.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-2">
                <span className="truncate text-ink">{k}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-accent" style={{ width: `${(v / value) * 100}%` }} /></span>
                <span className="num text-right text-muted">{f((v / value) * 100, 0)}%</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3 text-sm">
          <h3 className="font-bold text-ink">績效歸因（各筆對總報酬的貢獻）</h3>
          <ul className="num mt-2 space-y-1">
            {contrib.slice(0, 8).map((x) => (
              <li key={x.p.id} className="flex justify-between gap-2">
                <span className="truncate text-ink">{x.p.code} {(x.row?.name as string) ?? ""}</span>
                <span className={tone(x.pnl)}>{sgn((x.pnl! / cost) * 100)}%（{sgn(x.pnl, 0)} 元）</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, cls = "text-ink" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 font-bold ${cls}`}>{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function Holdings({ pf, by, onEdit, onRemove }: { pf: Pf; by: Map<string, Row>; onEdit: (p: Position) => void; onRemove: (id: string) => void }) {
  const c = calc(pf, by, null);
  const total = c.reduce((a, x) => a + (x.value ?? x.costAmt), 0);
  if (!c.length) return <div className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">還沒有持倉，用右邊的表單新增第一筆。</div>;
  return (
    <div className="space-y-2">
      {c.map((x) => {
        const flag = x.price != null && x.p.stop && x.price <= x.p.stop ? { t: "已跌破失效價", cls: "bg-warn-bg text-warn-ink" }
          : x.price != null && x.p.target && x.price >= x.p.target ? { t: "已達目標價", cls: "bg-accent-soft text-accent" } : null;
        const held = Math.round((Date.parse(todayStr()) - Date.parse(x.p.date)) / 86400000);
        return (
          <div key={x.p.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link href={`/stock/${x.p.code}`} className="font-bold text-ink hover:text-accent">{x.p.code} {(x.row?.name as string) ?? ""}</Link>
              {flag && <span className={`rounded px-1.5 py-0.5 text-xs ${flag.cls}`}>{flag.t}</span>}
              <span className="text-xs text-muted">{x.p.horizon ?? ""}{x.p.horizon ? "・" : ""}持有 {held} 天</span>
              <span className="ml-auto flex gap-3 text-xs">
                <button type="button" onClick={() => onEdit(x.p)} className="text-muted hover:text-ink">編輯</button>
                <button type="button" onClick={() => window.confirm(`刪除 ${x.p.code} 這筆持倉？`) && onRemove(x.p.id)} className="text-muted hover:text-up">刪除</button>
              </span>
            </div>
            <dl className="num mt-2 grid grid-cols-3 gap-x-4 gap-y-1 sm:grid-cols-6">
              <D k="股數" v={x.p.shares.toLocaleString()} />
              <D k="成本" v={f(x.p.cost)} />
              <D k="現價" v={f(x.price)} />
              <D k="損益" v={`${sgn(x.pnl, 0)}`} cls={tone(x.pnl)} />
              <D k="報酬率" v={`${sgn(x.ret)}%`} cls={tone(x.ret)} />
              <D k="權重" v={`${f(((x.value ?? x.costAmt) / total) * 100, 1)}%`} />
              <D k="目標價" v={x.p.target ? `${f(x.p.target)}（${x.price ? sgn((x.p.target / x.price - 1) * 100, 1) : "—"}%）` : "未設"} />
              <D k="失效價" v={x.p.stop ? `${f(x.p.stop)}（${x.price ? sgn((x.p.stop / x.price - 1) * 100, 1) : "—"}%）` : "未設"} />
              <D k="風險額度" v={x.risk == null ? "—" : `${f(x.risk, 0)} 元`} />
            </dl>
            {(x.p.reason || x.p.note) && (
              <p className="mt-2 text-xs leading-relaxed text-muted">{x.p.reason && <>理由：{x.p.reason}</>}{x.p.reason && x.p.note ? "　" : ""}{x.p.note && <>備註：{x.p.note}</>}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function D({ k, v, cls = "text-ink" }: { k: string; v: string; cls?: string }) {
  return <div><dt className="text-xs text-muted">{k}</dt><dd className={cls}>{v}</dd></div>;
}

function PositionForm({ init, by, onSave, onCancel }: { init: Position | null; by: Map<string, Row>; onSave: (p: Position) => void; onCancel: () => void }) {
  const [code, setCode] = useState(init?.code ?? "");
  const [shares, setShares] = useState<number | undefined>(init?.shares);
  const [cost, setCost] = useState<number | undefined>(init?.cost);
  const [date, setDate] = useState(init?.date ?? todayStr());
  const [horizon, setHorizon] = useState(init?.horizon ?? HORIZONS[1]);
  const [reason, setReason] = useState(init?.reason ?? "");
  const [target, setTarget] = useState<number | undefined>(init?.target ?? undefined);
  const [stop, setStop] = useState<number | undefined>(init?.stop ?? undefined);
  const [note, setNote] = useState(init?.note ?? "");
  const c = code.trim().toUpperCase();
  const row = by.get(c);
  const ok = !!row && !!shares && shares > 0 && !!cost && cost > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const input = "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";
  return (
    <form className="self-start rounded-lg border border-line bg-surface p-4 text-sm text-ink" onSubmit={(e) => {
      e.preventDefault();
      if (ok) onSave({ id: init?.id ?? uid(), code: c, shares: shares!, cost: cost!, date, horizon, reason: reason.slice(0, 500) || undefined,
        target: target ?? null, stop: stop ?? null, note: note.slice(0, 500) || undefined });
    }}>
      <h2 className="font-bold">{init ? "編輯持倉" : "新增持倉"}</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">代號
          <input value={code} onChange={(e) => setCode(e.target.value)} className={input} placeholder="例如 2330" />
          <span className={row ? "text-ink" : "text-muted"}>{c ? (row ? `${row.name}　收盤 ${f(num(row.close))}` : "找不到這個代號") : ""}</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">股數（1 張＝1000 股）<NumInput value={shares} onChange={setShares} label="股數" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">每股成本（元）<NumInput value={cost} onChange={setCost} label="每股成本" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">買進日期<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">預期持有期間
          <select value={horizon} onChange={(e) => setHorizon(e.target.value)} className={input}>{HORIZONS.map((h) => <option key={h}>{h}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">目標價（選填）<NumInput value={target} onChange={setTarget} label="目標價" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">失效價／停損（選填）<NumInput value={stop} onChange={setStop} label="失效價" /></label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">買進理由（選填）
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={input} placeholder="例如：營收連續成長、法人連買" />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">備註（選填）
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={!ok} className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40">{init ? "儲存" : "新增"}</button>
        {init && <button type="button" onClick={onCancel} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink">取消</button>}
      </div>
      <p className="mt-2 text-xs text-muted">失效價＝你認為看法錯了、該出場的價格，用來計算風險額度。到價提醒之後才會做。</p>
    </form>
  );
}
