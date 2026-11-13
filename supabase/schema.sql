-- Run once in the Supabase SQL Editor before deploying the portal.

create table if not exists public.extension_staff (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    role text not null check (role in ('owner', 'staff')),
    created_at timestamptz not null default now()
);

create table if not exists public.extension_access_requests (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    requested_at timestamptz not null default now()
);

create table if not exists public.extension_announcements (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    message text not null,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    published_at timestamptz not null default now(),
    is_published boolean not null default true
);

create table if not exists public.extension_releases (
    id uuid primary key default gen_random_uuid(),
    version text not null unique,
    title text not null,
    release_notes text not null,
    package_path text not null,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    is_published boolean not null default true
);

create or replace function public.is_extension_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.extension_staff
        where user_id = (select auth.uid())
    );
$$;

create or replace function public.is_extension_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.extension_staff
        where user_id = (select auth.uid())
          and role = 'owner'
    );
$$;

revoke all on function public.is_extension_staff() from public;
revoke all on function public.is_extension_owner() from public;
grant execute on function public.is_extension_staff() to anon, authenticated;
grant execute on function public.is_extension_owner() to authenticated;

alter table public.extension_staff enable row level security;
alter table public.extension_access_requests enable row level security;
alter table public.extension_announcements enable row level security;
alter table public.extension_releases enable row level security;

grant select on public.extension_announcements, public.extension_releases to anon, authenticated;
grant insert, update, delete on public.extension_announcements, public.extension_releases to authenticated;
grant select, insert, update, delete on public.extension_staff, public.extension_access_requests to authenticated;

drop policy if exists "Public can read published announcements" on public.extension_announcements;
create policy "Public can read published announcements"
    on public.extension_announcements for select to anon, authenticated
    using (is_published and published_at <= now());
drop policy if exists "Staff can manage announcements" on public.extension_announcements;
create policy "Staff can manage announcements"
    on public.extension_announcements for all to authenticated
    using (public.is_extension_staff())
    with check (public.is_extension_staff() and created_by = (select auth.uid()));

drop policy if exists "Public can read published releases" on public.extension_releases;
create policy "Public can read published releases"
    on public.extension_releases for select to anon, authenticated
    using (is_published);
drop policy if exists "Staff can manage releases" on public.extension_releases;
create policy "Staff can manage releases"
    on public.extension_releases for all to authenticated
    using (public.is_extension_staff())
    with check (public.is_extension_staff() and created_by = (select auth.uid()));

drop policy if exists "Users can read own staff role and owners can read all" on public.extension_staff;
create policy "Users can read own staff role and owners can read all"
    on public.extension_staff for select to authenticated
    using (user_id = (select auth.uid()) or public.is_extension_owner());
drop policy if exists "Owners can manage staff" on public.extension_staff;
create policy "Owners can manage staff"
    on public.extension_staff for all to authenticated
    using (public.is_extension_owner() and role = 'staff')
    with check (public.is_extension_owner() and role = 'staff');

drop policy if exists "Users can read own request and owners can read all" on public.extension_access_requests;
create policy "Users can read own request and owners can read all"
    on public.extension_access_requests for select to authenticated
    using (user_id = (select auth.uid()) or public.is_extension_owner());
drop policy if exists "Users can request their own access" on public.extension_access_requests;
create policy "Users can request their own access"
    on public.extension_access_requests for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and email = (select auth.jwt() ->> 'email')
    );
drop policy if exists "Owners can remove access requests" on public.extension_access_requests;
create policy "Owners can remove access requests"
    on public.extension_access_requests for delete to authenticated
    using (public.is_extension_owner());

insert into storage.buckets (id, name, public)
values ('grnd-extension-releases', 'grnd-extension-releases', true)
on conflict (id) do update set public = true;

drop policy if exists "Staff can upload extension releases" on storage.objects;
create policy "Staff can upload extension releases"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'grnd-extension-releases' and public.is_extension_staff());
drop policy if exists "Staff can update extension releases" on storage.objects;
create policy "Staff can update extension releases"
    on storage.objects for update to authenticated
    using (bucket_id = 'grnd-extension-releases' and public.is_extension_staff())
    with check (bucket_id = 'grnd-extension-releases' and public.is_extension_staff());
drop policy if exists "Staff can delete extension releases" on storage.objects;
create policy "Staff can delete extension releases"
    on storage.objects for delete to authenticated
    using (bucket_id = 'grnd-extension-releases' and public.is_extension_staff());

-- After creating and confirming your own portal account, find its UUID in
-- Authentication > Users, then run this once to bootstrap the owner:
-- insert into public.extension_staff (user_id, email, role)
-- values ('YOUR-AUTH-USER-UUID', 'you@example.com', 'owner');
