create table if not exists public.recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists recovery_codes_user_id_idx on public.recovery_codes(user_id);
alter table public.recovery_codes enable row level security;

create policy "users can manage their recovery codes"
on public.recovery_codes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
