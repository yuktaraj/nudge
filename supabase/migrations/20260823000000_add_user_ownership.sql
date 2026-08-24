alter table public.sources
add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists sources_user_id_idx on public.sources(user_id);

alter table public.sources enable row level security;
alter table public.generated_assets enable row level security;
alter table public.chunks enable row level security;
alter table public.parse_jobs enable row level security;

create policy "users can manage their sources"
on public.sources for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can read their generated assets"
on public.generated_assets for select
using (exists (select 1 from public.sources where sources.id = generated_assets.source_id and sources.user_id = auth.uid()));

create policy "users can read their chunks"
on public.chunks for select
using (exists (select 1 from public.sources where sources.id = chunks.source_id and sources.user_id = auth.uid()));

create policy "users can read their parse jobs"
on public.parse_jobs for select
using (exists (select 1 from public.sources where sources.id = parse_jobs.source_id and sources.user_id = auth.uid()));

drop policy if exists "single user mvp can upload study materials" on storage.objects;
drop policy if exists "single user mvp can read study materials" on storage.objects;

create policy "users can upload their study materials"
on storage.objects for insert
with check (
	bucket_id = 'study-materials'
	and exists (select 1 from public.sources where sources.storage_path = name and sources.user_id = auth.uid())
);

create policy "users can read their study materials"
on storage.objects for select
using (
	bucket_id = 'study-materials'
	and exists (select 1 from public.sources where sources.storage_path = name and sources.user_id = auth.uid())
);