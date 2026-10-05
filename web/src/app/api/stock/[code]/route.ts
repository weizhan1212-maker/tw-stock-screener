/** 個股資料：讀 Supabase Storage 的 site/stock/{code}.json.gz，原樣轉給瀏覽器（proxy.ts 已把關登入）。 */
import { readFile } from "node:fs/promises";
import { getObject } from "@/lib/storage";

export async function GET(_req: Request, ctx: RouteContext<"/api/stock/[code]">) {
  const { code } = await ctx.params;
  if (!/^[0-9A-Z]{4,6}$/.test(code)) return Response.json({ error: "代號格式不對" }, { status: 400 });
  const headers = { "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "private, max-age=600" };
  // 本機開發：STOCK_DIR=資料夾 直接讀檔
  if (process.env.STOCK_DIR && !process.env.VERCEL) {
    try {
      return new Response(new Uint8Array(await readFile(`${process.env.STOCK_DIR}/${code}.json.gz`)), { headers });
    } catch {
      return Response.json({ error: "找不到這檔股票的資料" }, { status: 404 });
    }
  }
  try {
    const res = await getObject(`site/stock/${code}.json.gz`);
    if (!res) return Response.json({ error: "找不到這檔股票的資料" }, { status: 404 });
    return new Response(await res.arrayBuffer(), { headers });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
