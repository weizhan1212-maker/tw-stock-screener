/**
 * 回測資料：轉送 Supabase Storage 的 site/bt/*（index.json、snap/YYYY-MM.json.gz、px/YYYY.json.gz）。
 * 過去月份與過去年份的檔案不會再變，讓瀏覽器長期快取；本機開發可設 BT_DIR=資料夾。
 */
import { readFile } from "node:fs/promises";
import { getObject } from "@/lib/storage";

const DAY = 86400;

export async function GET(_req: Request, ctx: RouteContext<"/api/bt/[...path]">) {
  const { path } = await ctx.params;
  const p = path.join("/");
  const now = new Date(Date.now() + 8 * 3600_000);            // 台灣時間
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  let maxAge: number;
  let gz = true;
  if (p === "index.json") { maxAge = 300; gz = false; }
  else if (/^snap\/\d{4}-\d{2}\.json\.gz$/.test(p)) maxAge = p.slice(5, 12) < ym ? 30 * DAY : 3600;
  else if (/^px\/\d{4}\.json\.gz$/.test(p)) maxAge = Number(p.slice(3, 7)) < now.getUTCFullYear() ? 30 * DAY : 300;
  else return Response.json({ error: "路徑不對" }, { status: 400 });

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${maxAge}`,
    ...(gz ? { "Content-Encoding": "gzip" } : {}),
  };
  if (process.env.BT_DIR && !process.env.VERCEL) {
    try {
      return new Response(new Uint8Array(await readFile(`${process.env.BT_DIR}/${p}`)), { headers });
    } catch {
      return Response.json({ error: "找不到回測資料" }, { status: 404 });
    }
  }
  try {
    const res = await getObject(`site/bt/${p}`);
    if (!res) return Response.json({ error: "回測資料還沒準備好" }, { status: 404 });
    return new Response(await res.arrayBuffer(), { headers });
  } catch (e) {
    console.error(e);                                         // 細節只留在伺服器紀錄，不回給瀏覽器
    return Response.json({ error: "資料暫時讀不到，請稍後再試" }, { status: 502 });
  }
}
