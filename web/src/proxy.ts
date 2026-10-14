/**
 * 存取控制：
 * - 沒登入 → 登入頁（API 回 401）
 * - 已登入但還沒核准 → 等待核准頁（API 回 403）
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";

// 這兩個由外部呼叫，各自用密鑰驗證：Telegram webhook、每日警報評估
const PUBLIC = ["/login", "/about", "/api/auth", "/api/telegram/webhook", "/api/alerts/run"];

// 正式網址只有一個（Google 登入只登記這個網域的回呼網址）；從 Vercel 另一個預設網址進來的一律轉過去
const CANONICAL = "tw-stock-screener-willy1212.vercel.app";
const ALIASES = ["tw-stock-screener-ten.vercel.app"];

export const proxy = auth((req) => {
  const path = req.nextUrl.pathname;
  const host = req.headers.get("host") ?? "";
  if (ALIASES.includes(host)) {
    const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${CANONICAL}`);
    return NextResponse.redirect(url, 308);
  }
  // 本機測試用：只有在非 Vercel 環境且明確設定 SKIP_AUTH=1 時才跳過登入
  if (process.env.SKIP_AUTH === "1" && !process.env.VERCEL) return NextResponse.next();
  if (PUBLIC.some((p) => path.startsWith(p))) return NextResponse.next();
  const user = req.auth?.user as { status?: string } | undefined;
  const isApi = path.startsWith("/api/");
  if (!user) {
    return isApi
      ? NextResponse.json({ error: "請先登入" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (user.status !== "approved" && !path.startsWith("/pending")) {
    return isApi
      ? NextResponse.json({ error: "帳號尚未核准" }, { status: 403 })
      : NextResponse.redirect(new URL("/pending", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|manifest.webmanifest|icons/).*)"],
};
