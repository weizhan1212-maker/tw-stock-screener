/** 市場總覽：讀 pipeline 產生的 site/market.json.gz（登入且核准才能呼叫，proxy.ts 把關）。 */
import { readFile } from "node:fs/promises";
import { getCachedBytes } from "@/lib/storage";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "private, max-age=300" };

export async function GET() {
  const file = process.env.MARKET_FILE;
  if (file) return new Response(new Uint8Array(await readFile(file)), { headers: HEADERS });
  try {
    const buf = await getCachedBytes("site/market.json.gz", 120_000);
    if (!buf) return Response.json({ error: "還沒有市場總覽資料" }, { status: 404 });
    return new Response(buf, { headers: HEADERS });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
