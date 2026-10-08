"use client";

/**
 * 把畫面上的篩選選項（分頁、市場、類型…）記在網址查詢字串，點進個股再按返回時能回到原本的選項。
 * 用 replaceState 更新，不會多出一筆瀏覽紀錄。頁面要包在 <Suspense> 裡（useSearchParams 的要求）。
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function useUrlState<T extends string>(key: string, initial: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const q = useSearchParams();
  const fromUrl = q.get(key) as T | null;
  const [v, setV] = useState<T>(() => (fromUrl != null && (!allowed || allowed.includes(fromUrl)) ? fromUrl : initial));
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (v === initial) p.delete(key); else p.set(key, v);
    const s = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, [key, v, initial]);
  return [v, setV];
}
