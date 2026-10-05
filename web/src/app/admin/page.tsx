import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { adminEmails, isAdmin, readAllowlist, setStatus, type Status } from "@/lib/allowlist";

export const metadata = { title: "成員管理｜股見未來" };

const LABEL: Record<Status, string> = { approved: "已核准", pending: "待核准", rejected: "已拒絕" };

async function decide(formData: FormData) {
  "use server";
  const session = await auth();
  if (!isAdmin(session?.user?.email)) throw new Error("只有管理員可以操作");
  const email = String(formData.get("email") ?? "");
  const action = String(formData.get("action") ?? "") as Status | "remove";
  if (!email || !["approved", "rejected", "remove"].includes(action)) return;
  await setStatus(email, action);
  revalidatePath("/admin");
}

async function invite(formData: FormData) {
  "use server";
  const session = await auth();
  if (!isAdmin(session?.user?.email)) throw new Error("只有管理員可以操作");
  const email = String(formData.get("email") ?? "").trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) await setStatus(email, "approved");
  revalidatePath("/admin");
}

export default async function AdminPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) redirect("/");
  const list = await readAllowlist();
  const order: Status[] = ["pending", "approved", "rejected"];
  const members = Object.values(list.users).sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.requested_at.localeCompare(a.requested_at),
  );
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold text-ink">成員管理</h1>
      <p className="mt-2 text-sm text-muted">朋友用 Google 登入後會出現在這裡，核准後就能使用。管理員：{adminEmails().join("、")}</p>

      <form action={invite} className="mt-5 flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="直接加入朋友的 Gmail"
          aria-label="朋友的 Gmail"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
          加入並核准
        </button>
      </form>

      {members.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
          還沒有人申請。把網址傳給朋友，請他用 Google 登入，就會出現在這裡。
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-surface">
          {members.map((m) => (
            <li key={m.email} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate text-ink">{m.name ? `${m.name}（${m.email}）` : m.email}</div>
                <div className="text-xs text-muted">申請時間 {new Date(m.requested_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</div>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs ${m.status === "pending" ? "bg-warn-bg text-warn-ink" : m.status === "approved" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>
                {LABEL[m.status]}
              </span>
              <form action={decide} className="flex gap-1.5">
                <input type="hidden" name="email" value={m.email} />
                {m.status !== "approved" && (
                  <button name="action" value="approved" className="rounded-md border border-line px-2.5 py-1 text-ink hover:border-accent">核准</button>
                )}
                {m.status !== "rejected" && (
                  <button name="action" value="rejected" className="rounded-md border border-line px-2.5 py-1 text-muted hover:text-ink">
                    {m.status === "approved" ? "停用" : "拒絕"}
                  </button>
                )}
                <button name="action" value="remove" className="rounded-md px-2 py-1 text-muted hover:text-up" aria-label={`刪除 ${m.email}`}>
                  刪除
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
