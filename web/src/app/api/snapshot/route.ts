/**
 * 篩選快照：從 Supabase Storage（私有）讀取 pipeline 產生的 site/snapshot.json.gz，原樣轉給瀏覽器。
 * 只有登入且已核准的使用者能呼叫（proxy.ts 把關）。本機開發可設 SNAPSHOT_FILE=路徑 直接讀檔。
 */
import { readFile } from "node:fs/promises";
import { getCachedBytes } from "@/lib/storage";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Content-Encoding": "gzip",
  "Cache-Control": "private, max-age=300",
};

export async function GET() {
  const file = process.env.SNAPSHOT_FILE;
  if (file) return new Response(new Uint8Array(await readFile(file)), { headers: HEADERS });
  try {
    const buf = await getCachedBytes("site/snapshot.json.gz", 120_000);
    if (!buf) return Response.json({ error: "還沒有篩選快照" }, { status: 404 });
    return new Response(buf, { headers: HEADERS });
  } catch (e) {
    console.error(e);                                         // 細節只留在伺服器紀錄，不回給瀏覽器
    return Response.json({ error: "資料暫時讀不到，請稍後再試" }, { status: 502 });
  }
}
