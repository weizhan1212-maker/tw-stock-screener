/**
 * 盤中即時報價（富果）。試用期間只開放管理員（Willy）：富果條款是否允許給他人看尚未確認。
 * GET /api/quote?codes=2330,2317（最多 30 檔）
 */
import { auth } from "@/auth";
import { isAdmin } from "@/lib/allowlist";
import { fugleEnabled, quote, type LiveQuote } from "@/lib/fugle";

const MAX = 30;

export async function GET(req: Request) {
  if (!fugleEnabled()) return Response.json({ enabled: false }, { status: 404 });
  const local = process.env.SKIP_AUTH === "1" && !process.env.VERCEL;
  if (!local) {
    const s = await auth();
    if (!isAdmin(s?.user?.email)) return Response.json({ enabled: false }, { status: 403 });
  }
  const codes = [...new Set((new URL(req.url).searchParams.get("codes") ?? "").split(","))]
    .filter((c) => /^[0-9A-Z]{4,6}$/.test(c)).slice(0, MAX);
  const quotes: Record<string, LiveQuote> = {};
  let failed = 0;
  // 一次 5 檔，避免瞬間打太多
  for (let i = 0; i < codes.length; i += 5) {
    const res = await Promise.allSettled(codes.slice(i, i + 5).map(quote));
    res.forEach((r, k) => {
      if (r.status === "fulfilled" && r.value) quotes[codes[i + k]] = r.value;
      else failed++;
    });
  }
  return Response.json({ enabled: true, quotes, failed }, { headers: { "Cache-Control": "no-store" } });
}
