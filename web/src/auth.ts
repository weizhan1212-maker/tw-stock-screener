/**
 * Google 登入（Auth.js）。需要 Vercel 環境變數 AUTH_GOOGLE_ID、AUTH_GOOGLE_SECRET。
 * AUTH_SECRET 沒設定時，由 SUPABASE_SERVICE_KEY 衍生（兩者都只存在伺服器端）。
 * 使用者狀態（已核准／待核准）放在 JWT，每 5 分鐘重新查一次白名單。
 */
import { createHash } from "node:crypto";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { statusFor } from "@/lib/allowlist";

const secret =
  process.env.AUTH_SECRET ??
  (process.env.SUPABASE_SERVICE_KEY
    ? createHash("sha256").update(`authjs:${process.env.SUPABASE_SERVICE_KEY}`).digest("hex")
    : undefined);

const RECHECK_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  secret,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      const email = (user?.email ?? token.email) as string | undefined;
      if (!email) return token;
      const stale = !token.checkedAt || Date.now() - (token.checkedAt as number) > RECHECK_MS;
      if (user || stale) {
        try {
          token.status = await statusFor(email, user?.name ?? (token.name as string | undefined));
          token.checkedAt = Date.now();
        } catch {
          // 白名單暫時讀不到：保留原本狀態，下次再查
        }
      }
      return token;
    },
    async session({ session, token }) {
      (session.user as { status?: string }).status = (token.status as string) ?? "pending";
      return session;
    },
  },
});
