/**
 * 白名單（邀請制）：存在 Supabase Storage 的 auth/allowlist.json。
 * 第一次用 Google 登入的人會被記為「待核准」，管理員在 /admin 核准後才能使用。
 * 管理員（ADMIN_EMAILS，逗號分隔；預設 Willy）永遠是已核准。
 */
import "server-only";
import { getJson, putJson } from "./storage";

export type Status = "approved" | "pending" | "rejected";
export interface Member {
  email: string;
  name?: string;
  status: Status;
  requested_at: string;
  decided_at?: string;
}
interface Allowlist {
  users: Record<string, Member>;
}

const PATH = "auth/allowlist.json";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "weizhan1212@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdmin = (email?: string | null) => !!email && adminEmails().includes(email.toLowerCase());

export async function readAllowlist(): Promise<Allowlist> {
  return getJson<Allowlist>(PATH, { users: {} });
}

/** 查狀態；沒看過的人自動登記為待核准。 */
export async function statusFor(email: string, name?: string | null): Promise<Status> {
  const e = email.toLowerCase();
  if (isAdmin(e)) return "approved";
  const list = await readAllowlist();
  const m = list.users[e];
  if (m) return m.status;
  list.users[e] = { email: e, name: name ?? undefined, status: "pending", requested_at: new Date().toISOString() };
  await putJson(PATH, list);
  return "pending";
}

export async function setStatus(email: string, status: Status | "remove") {
  const list = await readAllowlist();
  const e = email.toLowerCase();
  if (status === "remove") {
    delete list.users[e];
  } else {
    const m = list.users[e] ?? { email: e, status, requested_at: new Date().toISOString() };
    list.users[e] = { ...m, status, decided_at: new Date().toISOString() };
  }
  await putJson(PATH, list);
}
