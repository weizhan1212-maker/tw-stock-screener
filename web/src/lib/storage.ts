/**
 * 伺服器端：讀寫資料檔（私有）。金鑰只在伺服器端使用。
 * STORAGE=r2 時用 Cloudflare R2（S3 相容，下載流量免費）；否則用 Supabase Storage。
 */
import "server-only";
import { AwsClient } from "aws4fetch";

const isR2 = () => (process.env.STORAGE ?? "").toLowerCase() === "r2";

let r2: { client: AwsClient; base: string } | null = null;
function r2cfg() {
  if (r2) return r2;
  const acct = process.env.R2_ACCOUNT_ID, id = process.env.R2_ACCESS_KEY_ID, secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!acct || !id || !secret) throw new Error("伺服器尚未設定 R2_ACCOUNT_ID／R2_ACCESS_KEY_ID／R2_SECRET_ACCESS_KEY");
  r2 = {
    client: new AwsClient({ accessKeyId: id, secretAccessKey: secret, service: "s3", region: "auto" }),
    base: `${process.env.R2_ENDPOINT ?? `https://${acct}.r2.cloudflarestorage.com`}/${process.env.R2_BUCKET ?? "market-data"}`,   // R2_ENDPOINT 只有測試時會設
  };
  return r2;
}

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("伺服器尚未設定 SUPABASE_URL／SUPABASE_SERVICE_KEY");
  const u = new URL(url.includes("://") ? url : `https://${url}`);
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return { base: `${u.protocol}//${u.host}/storage/v1`, bucket: process.env.SUPABASE_BUCKET ?? "market-data", headers };
}

const objPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export async function getObject(path: string): Promise<Response | null> {
  if (isR2()) {
    const { client, base } = r2cfg();
    const res = await client.fetch(`${base}/${objPath(path)}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`讀取 ${path} 失敗（R2 ${res.status}）`);
    return res;
  }
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
  if (isR2()) {
    const { client, base } = r2cfg();
    const res = await client.fetch(`${base}/${objPath(path)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(`寫入 ${path} 失敗（R2 ${res.status}）`);
    return;
  }
  const { base, bucket, headers } = cfg();
  const res = await fetch(`${base}/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...headers, "x-upsert": "true", "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`寫入 ${path} 失敗（${res.status}）`);
}

// 伺服器記憶體快取：同一個 Vercel 執行個體在 ttl 內重複要同一個檔，就不再重新下載
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
