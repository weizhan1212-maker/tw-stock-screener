/**
 * 存取控制：
 * - 沒登入 → 登入頁（API 回 401）
 * - 已登入但還沒核准 → 等待核准頁（API 回 403）
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC = ["/login", "/api/auth"];

export const proxy = auth((req) => {
  const path = req.nextUrl.pathname;
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png).*)"],
};
