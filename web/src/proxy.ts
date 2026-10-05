/**
 * 臨時密碼鎖（Google 登入做好之前使用）：
 * Vercel 環境變數設定 SITE_PASSWORD 後，整個網站與 API 都要輸入帳號 friend／密碼才能看。
 * 沒設定 SITE_PASSWORD 就不檢查（本機開發用）。
 */
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();
  const auth = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme === "Basic" && encoded) {
    const [, pass] = atob(encoded).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("需要密碼", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="tw-stock-screener", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
