"use client";

/** 自選股：整個網站共用一份狀態（換頁不重抓），加入／移除時立刻更新畫面再存到伺服器。 */
import { useSyncExternalStore } from "react";

let codes: string[] | null = null;
let loading: Promise<void> | null = null;
let error: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function load() {
  if (!loading) {
    loading = fetch("/api/me/watchlist")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        codes = j.codes ?? [];
      })
      .catch((e) => { error = String(e.message ?? e); codes = codes ?? []; loading = null; })
      .finally(emit);
  }
}

async function save(next: string[]) {
  const prev = codes;
  codes = next;
  emit();
  try {
    const r = await fetch("/api/me/watchlist", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: next }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    error = null;
  } catch (e) {
    codes = prev;
    error = `儲存失敗：${(e as Error).message}`;
    emit();
  }
}

const snapshot = () => codes;
const serverSnapshot = () => null;
const subscribe = (f: () => void) => {
  subs.add(f);
  load();
  return () => subs.delete(f);
};

export function useWatchlist() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return {
    codes: list,
    error,
    has: (c: string) => !!list?.includes(c),
    toggle: (c: string) => list && save(list.includes(c) ? list.filter((x) => x !== c) : [c, ...list]),
    remove: (c: string) => list && save(list.filter((x) => x !== c)),
    move: (c: string, dir: -1 | 1) => {
      if (!list) return;
      const i = list.indexOf(c), j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      save(next);
    },
  };
}
