"use client";

import { useEffect, useState } from "react";
import { decode, type RawSnapshot, type Snapshot } from "@/lib/screener";

// 同一次瀏覽只下載一次快照（切換頁面不重抓）
let cache: Promise<Snapshot> | null = null;

function load(): Promise<Snapshot> {
  if (!cache) {
    cache = fetch("/api/snapshot").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return decode(j as RawSnapshot);
    });
    cache.catch(() => (cache = null));
  }
  return cache;
}

export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load()
      .then((s) => alive && setSnap(s))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);
  return { snap, error };
}
