/** 指數歷史：讀 pipeline 產生的 site/indices.json.gz（登入且核准才能呼叫）。 */
import { readFile } from "node:fs/promises";
import { getCachedBytes } from "@/lib/storage";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "private, max-age=600" };

export async function GET() {
  const file = process.env.INDICES_FILE;
  if (file && !process.env.VERCEL) return new Response(new Uint8Array(await readFile(file)), { headers: HEADERS });
  try {
    const buf = await getCachedBytes("site/indices.json.gz", 300_000);
    if (!buf) return Response.json({ error: "還沒有指數歷史資料" }, { status: 404 });
    return new Response(buf, { headers: HEADERS });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
