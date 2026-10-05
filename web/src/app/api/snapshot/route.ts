/**
 * 篩選快照：從 Supabase Storage（私有）讀取 pipeline 產生的 site/snapshot.json.gz，原樣轉給瀏覽器。
 * 只有登入且已核准的使用者能呼叫（proxy.ts 把關）。本機開發可設 SNAPSHOT_FILE=路徑 直接讀檔。
 */
import { readFile } from "node:fs/promises";
import { getObject } from "@/lib/storage";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Content-Encoding": "gzip",
  "Cache-Control": "private, max-age=300",
};

export async function GET() {
  const file = process.env.SNAPSHOT_FILE;
  if (file) return new Response(new Uint8Array(await readFile(file)), { headers: HEADERS });
  try {
    const res = await getObject("site/snapshot.json.gz");
    if (!res) return Response.json({ error: "還沒有篩選快照" }, { status: 404 });
    return new Response(await res.arrayBuffer(), { headers: HEADERS });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
