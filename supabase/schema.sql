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

create table if not exists public.extension_usage (
    install_id uuid primary key,
    version text not null check (version ~ '^[A-Za-z0-9._+-]{1,32}$'),
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.extension_feedback (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    email text not null,
    category text not null check (category in ('feature', 'bug', 'other')),
    title text not null check (char_length(title) between 1 and 120),
    message text not null check (char_length(message) between 1 and 4000),
    status text not null default 'new' check (status in ('new', 'reviewing', 'planned', 'done', 'declined')),
    created_at timestamptz not null default now(),
    check (email = lower(email))
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

create or replace function public.record_extension_usage(p_install_id uuid, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_install_id is null or p_version is null
       or p_version !~ '^[A-Za-z0-9._+-]{1,32}$' then
        raise exception 'Invalid usage event' using errcode = '22023';
    end if;

    insert into public.extension_usage (install_id, version, first_seen_at, last_seen_at)
    values (p_install_id, p_version, now(), now())
    on conflict (install_id) do update
        set version = excluded.version,
            last_seen_at = now();
end;
$$;

create or replace function public.opt_out_extension_usage(p_install_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    delete from public.extension_usage
    where install_id = p_install_id;
$$;

create or replace function public.get_extension_usage_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    stats jsonb;
begin
    if not public.is_extension_owner() then
        raise exception 'Not authorized' using errcode = '42501';
    end if;

    select jsonb_build_object(
        'total_installs',
        (select count(*) from public.extension_usage),
        'active_30_days',
        (select count(*) from public.extension_usage
         where last_seen_at >= now() - interval '30 days'),
        'new_30_days',
        (select count(*) from public.extension_usage
         where first_seen_at >= now() - interval '30 days'),
        'versions',
        coalesce((
            select jsonb_agg(jsonb_build_object('version', version, 'active_installs', active_installs)
                             order by active_installs desc, version)
            from (
                select version, count(*) as active_installs
                from public.extension_usage
                where last_seen_at >= now() - interval '30 days'
                group by version
            ) version_counts
        ), '[]'::jsonb)
    ) into stats;

    return stats;
end;
$$;

revoke all on function public.is_extension_staff() from public;
revoke all on function public.is_extension_owner() from public;
revoke all on function public.record_extension_usage(uuid, text) from public;
revoke all on function public.opt_out_extension_usage(uuid) from public;
revoke all on function public.get_extension_usage_stats() from public;
grant execute on function public.is_extension_staff() to anon, authenticated;
grant execute on function public.is_extension_owner() to authenticated;
grant execute on function public.record_extension_usage(uuid, text) to anon, authenticated;
grant execute on function public.opt_out_extension_usage(uuid) to anon, authenticated;
grant execute on function public.get_extension_usage_stats() to authenticated;

alter table public.extension_staff enable row level security;
alter table public.extension_access_requests enable row level security;
alter table public.extension_announcements enable row level security;
alter table public.extension_releases enable row level security;
alter table public.extension_usage enable row level security;
alter table public.extension_feedback enable row level security;

grant select on public.extension_announcements, public.extension_releases to anon, authenticated;
grant insert, update, delete on public.extension_announcements, public.extension_releases to authenticated;
grant select, insert, update, delete on public.extension_staff, public.extension_access_requests to authenticated;
revoke all on public.extension_usage from public, anon, authenticated;
revoke all on public.extension_feedback from public, anon, authenticated;
grant select, insert on public.extension_feedback to authenticated;
grant update (status) on public.extension_feedback to authenticated;

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

drop policy if exists "Users can submit and read their own feedback" on public.extension_feedback;
create policy "Users can submit and read their own feedback"
    on public.extension_feedback for select to authenticated
    using (user_id = (select auth.uid()));
drop policy if exists "Staff can read all feedback" on public.extension_feedback;
create policy "Staff can read all feedback"
    on public.extension_feedback for select to authenticated
    using (public.is_extension_staff());
drop policy if exists "Authenticated users can submit feedback" on public.extension_feedback;
create policy "Authenticated users can submit feedback"
    on public.extension_feedback for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and email = lower((select auth.jwt() ->> 'email'))
    );
drop policy if exists "Staff can update feedback status" on public.extension_feedback;
create policy "Staff can update feedback status"
    on public.extension_feedback for update to authenticated
    using (public.is_extension_staff())
    with check (public.is_extension_staff());

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
