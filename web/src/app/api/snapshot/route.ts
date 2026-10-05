/**
 * 篩選快照：從 Supabase Storage（私有）讀取 pipeline 產生的 site/snapshot.json.gz，原樣轉給瀏覽器。
 * 金鑰只存在伺服器端環境變數，不會送到瀏覽器。
 * 本機開發可設 SNAPSHOT_FILE=路徑 直接讀檔。
 */
import { readFile } from "node:fs/promises";

function storageBase(url: string) {
  const u = new URL(url.includes("://") ? url : `https://${url}`);
  return `${u.protocol}//${u.host}/storage/v1`;
}

export async function GET() {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Encoding": "gzip",
    "Cache-Control": "private, max-age=300",
  };
  const file = process.env.SNAPSHOT_FILE;
  if (file) {
    return new Response(new Uint8Array(await readFile(file)), { headers });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return Response.json({ error: "伺服器尚未設定 SUPABASE_URL／SUPABASE_SERVICE_KEY" }, { status: 503 });
  }
  const auth: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_secret_")) auth.Authorization = `Bearer ${key}`;
  const bucket = process.env.SUPABASE_BUCKET ?? "market-data";
  const res = await fetch(`${storageBase(url)}/object/${bucket}/site/snapshot.json.gz`, {
    headers: auth,
    cache: "no-store",
  });
  if (!res.ok) {
    return Response.json({ error: `讀取快照失敗（${res.status}）` }, { status: 502 });
  }
  return new Response(await res.arrayBuffer(), { headers });
}
