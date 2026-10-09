/** 伺服器端：目前登入（且已核准）的使用者，以及每位使用者在 Storage 的資料夾。 */
import "server-only";
import { createHash } from "node:crypto";
import { auth } from "@/auth";

export const userHash = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32);
export const userPath = (hash: string, file: string) => `users/${hash}/${file}`;

export async function currentUser(): Promise<{ email: string; hash: string } | null> {
  // 本機測試用：與 proxy.ts 相同的條件（非 Vercel 且明確設定 SKIP_AUTH=1）
  if (process.env.SKIP_AUTH === "1" && !process.env.VERCEL) return { email: "dev@local.test", hash: userHash("dev@local.test") };
  const s = await auth();
  const u = s?.user as { email?: string; status?: string } | undefined;
  if (!u?.email || u.status !== "approved") return null;
  return { email: u.email, hash: userHash(u.email) };
}

/** 由伺服器金鑰衍生的內部密鑰（GitHub Actions 與 Vercel 都有 SUPABASE_SERVICE_KEY，不必另設） */
export function derivedSecret(purpose: string): string | null {
  const k = process.env.SUPABASE_SERVICE_KEY;
  return k ? createHash("sha256").update(`${purpose}:${k}`).digest("hex").slice(0, 40) : null;
}
