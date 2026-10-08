import { auth, signOut } from "@/auth";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { isAdmin } from "@/lib/allowlist";

export default async function UserMenu() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return <ThemeToggle />;
  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }
  return <AccountMenu email={email} admin={isAdmin(email)} signOut={doSignOut} />;
}
