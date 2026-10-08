-- 股見未來：使用者資料表（白名單、警報名單、每人資料）
-- 在 Supabase → SQL Editor 貼上整段 → Run。重複執行也不會出錯。
-- 只有伺服器（service key）能讀寫；開啟 RLS 且不給任何政策 = 一般公開金鑰完全讀不到。

create table if not exists public.members (
  email        text primary key,
  name         text,
  status       text not null default 'pending' check (status in ('approved', 'pending', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz
);

create table if not exists public.alert_users (
  user_hash text primary key,
  added_at  timestamptz not null default now()
);

create table if not exists public.user_kv (
  user_hash  text not null,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_hash, key)
);

alter table public.members     enable row level security;
alter table public.alert_users enable row level security;
alter table public.user_kv     enable row level security;

-- 確認：應該看到 3 列
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('members', 'alert_users', 'user_kv');
