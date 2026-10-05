import Link from "next/link";
import { auth, signOut } from "@/auth";
import { isAdmin } from "@/lib/allowlist";

export default async function UserMenu() {
  const session = await auth();
  if (!session?.user) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      {isAdmin(session.user.email) && (
        <Link href="/admin" className="text-muted hover:text-ink">成員管理</Link>
      )}
      <span className="hidden max-w-48 truncate text-muted sm:inline">{session.user.email}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="text-muted hover:text-ink">登出</button>
      </form>
    </div>
  );
}
