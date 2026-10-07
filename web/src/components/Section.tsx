import type { ReactNode } from "react";
import type { Stamp } from "@/lib/stock";

/** 個股頁的區塊外框：標題、說明、資料日期（落後時黃色） */
export default function Section({ id, title, note, stamp, children }: { id: string; title: string; note?: ReactNode; stamp?: Stamp | null; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <div className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-xs">
          {note && <span className="text-muted">{note}</span>}
          {stamp && (
            <span className={`num rounded px-1.5 py-0.5 ${stamp.late ? "bg-warn-bg text-warn-ink" : "text-muted"}`} title={stamp.late ? stamp.hint : undefined}>
              {stamp.text}{stamp.late && stamp.hint ? `（${stamp.hint}）` : ""}
            </span>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
