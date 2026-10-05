import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export const metadata = { title: "等待核准｜股見未來" };

export default async function PendingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const status = (session.user as { status?: string }).status;
  if (status === "approved") redirect("/");
  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <h1 className="text-2xl font-bold text-ink">{status === "rejected" ? "無法使用" : "已送出申請"}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {status === "rejected"
          ? `${session.user.email} 沒有使用權限。如果有疑問，請直接聯絡管理員。`
          : `${session.user.email} 已登記，等管理員核准後就能使用（核准後最多 5 分鐘生效，重新整理即可）。`}
      </p>
      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="text-sm text-muted underline underline-offset-2 hover:text-ink">
          換一個帳號登入
        </button>
      </form>
    </div>
  );
}
