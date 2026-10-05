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
