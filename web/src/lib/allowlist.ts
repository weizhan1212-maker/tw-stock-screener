/**
 * 白名單（邀請制）：存在 Supabase 資料庫 members 表（一人一列，同時登入或核准不會互相蓋掉）。
 * 第一次用 Google 登入的人會被記為「待核准」，管理員在 /admin 核准後才能使用。
 * 管理員（ADMIN_EMAILS，逗號分隔；預設 Willy）永遠是已核准。
 */
import "server-only";
import { type Member, memberGet, memberList, memberRemove, memberRequest, memberSet, type Status } from "./server/db";

export type { Member, Status };
interface Allowlist {
  users: Record<string, Member>;
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "weizhan1212@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdmin = (email?: string | null) => !!email && adminEmails().includes(email.toLowerCase());

export async function readAllowlist(): Promise<Allowlist> {
  return { users: Object.fromEntries((await memberList()).map((m) => [m.email, m])) };
}

/** 查狀態；沒看過的人自動登記為待核准。 */
export async function statusFor(email: string, name?: string | null): Promise<Status> {
  const e = email.toLowerCase();
  if (isAdmin(e)) return "approved";
  const m = await memberGet(e);
  if (m) return m.status;
  await memberRequest(e, name);
  return "pending";
}

export async function setStatus(email: string, status: Status | "remove") {
  const e = email.toLowerCase();
  if (status === "remove") await memberRemove(e);
  else await memberSet(e, status);
}
