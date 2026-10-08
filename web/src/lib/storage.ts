/** 伺服器端：讀寫 Supabase Storage（私有 bucket）。金鑰只在伺服器端使用。 */
import "server-only";

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("伺服器尚未設定 SUPABASE_URL／SUPABASE_SERVICE_KEY");
  const u = new URL(url.includes("://") ? url : `https://${url}`);
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return { base: `${u.protocol}//${u.host}/storage/v1`, bucket: process.env.SUPABASE_BUCKET ?? "market-data", headers };
}

export async function getObject(path: string): Promise<Response | null> {
  const { base, bucket, headers } = cfg();
  const res = await fetch(`${base}/object/${bucket}/${path}`, { headers, cache: "no-store" });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`讀取 ${path} 失敗（${res.status}）`);
  return res;
}

export async function getJson<T>(path: string, fallback: T): Promise<T> {
  const res = await getObject(path);
  return res ? ((await res.json()) as T) : fallback;
}

export async function putJson(path: string, data: unknown) {
  const { base, bucket, headers } = cfg();
  const res = await fetch(`${base}/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...headers, "x-upsert": "true", "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`寫入 ${path} 失敗（${res.status}）`);
}

// 伺服器記憶體快取：同一個 Vercel 執行個體在 ttl 內重複要同一個檔，就不再向 Supabase 下載（省每月傳輸量）
const memo = new Map<string, { t: number; buf: ArrayBuffer | null }>();
let memoBytes = 0;
const MEMO_MAX = 80 * 1024 * 1024;

export async function getCachedBytes(path: string, ttlMs: number): Promise<ArrayBuffer | null> {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.t < ttlMs) {
    memo.delete(path); memo.set(path, hit);                    // 移到最新（LRU）
    return hit.buf;
  }
  const res = await getObject(path);
  const buf = res ? await res.arrayBuffer() : null;
  if (hit) { memoBytes -= hit.buf?.byteLength ?? 0; memo.delete(path); }
  memo.set(path, { t: Date.now(), buf });
  memoBytes += buf?.byteLength ?? 0;
  for (const [k, v] of memo) {                                  // 超過上限就丟掉最久沒用的
    if (memoBytes <= MEMO_MAX) break;
    memo.delete(k); memoBytes -= v.buf?.byteLength ?? 0;
  }
  return buf;
}
