/**
 * 伺服器端：Supabase Postgres（PostgREST）。使用者狀態一律放這裡，不放物件儲存：
 * 每筆資料一列、寫入是單列 upsert，不會像整份 JSON 讀改寫那樣互相蓋掉。
 * 表：members（白名單）、alert_users（有設警報的人）、user_kv（每人每種資料一列）。SQL 見 docs/sql/001_user_tables.sql。
 */
import "server-only";

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("伺服器尚未設定 SUPABASE_URL／SUPABASE_SERVICE_KEY");
  const u = new URL(url.includes("://") ? url : `https://${url}`);
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return { base: `${u.protocol}//${u.host}/rest/v1`, headers };
}

async function rest<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const { base, headers } = cfg();
  const res = await fetch(`${base}/${path}`, {
    ...init, cache: "no-store",
    headers: { ...headers, ...(init.prefer ? { Prefer: init.prefer } : {}), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) throw new Error(`資料庫 ${init.method ?? "GET"} ${path.split("?")[0]} 失敗（${res.status}）：${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const enc = encodeURIComponent;

// ---------- 每人資料（user_kv） ----------
export type UserKey = "watchlist" | "screens" | "portfolio" | "alerts" | "alert_state" | "telegram";

export async function kvGet<T>(hash: string, key: UserKey, fallback: T): Promise<T> {
  const rows = await rest<{ value: T }[]>(`user_kv?select=value&user_hash=eq.${enc(hash)}&key=eq.${key}`);
  return rows.length ? rows[0].value : fallback;
}

export async function kvPut(hash: string, key: UserKey, value: unknown) {
  await rest("user_kv?on_conflict=user_hash,key", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ user_hash: hash, key, value, updated_at: new Date().toISOString() }),
  });
}

// ---------- 白名單（members） ----------
export type Status = "approved" | "pending" | "rejected";
export interface Member { email: string; name?: string | null; status: Status; requested_at: string; decided_at?: string | null }

export async function memberGet(email: string): Promise<Member | null> {
  const rows = await rest<Member[]>(`members?select=*&email=eq.${enc(email)}`);
  return rows[0] ?? null;
}

/** 第一次登入：新增一列待核准；已經有的人不動（不會蓋掉管理員剛核准的狀態）。 */
export async function memberRequest(email: string, name?: string | null) {
  await rest("members?on_conflict=email", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
    body: JSON.stringify({ email, name: name ?? null, status: "pending" }),
  });
}

export async function memberSet(email: string, status: Status) {
  await rest("members?on_conflict=email", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ email, status, decided_at: new Date().toISOString() }),
  });
}

export async function memberRemove(email: string) {
  await rest(`members?email=eq.${enc(email)}`, { method: "DELETE", prefer: "return=minimal" });
}

export async function memberList(): Promise<Member[]> {
  return rest<Member[]>("members?select=*&order=requested_at.desc");
}

// ---------- 有設警報的人（alert_users） ----------
export async function alertUserAdd(hash: string) {
  await rest("alert_users?on_conflict=user_hash", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: JSON.stringify({ user_hash: hash }),
  });
}

export async function alertUsers(): Promise<string[]> {
  return (await rest<{ user_hash: string }[]>("alert_users?select=user_hash")).map((r) => r.user_hash);
}
