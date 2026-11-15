-- Run in the Supabase SQL Editor before deploying or upgrading the portal.

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
    user_id uuid references auth.users(id) on delete set null,
    version text not null check (version ~ '^[A-Za-z0-9._+-]{1,32}$'),
    admin_name text check (admin_name is null or char_length(admin_name) between 1 and 64),
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

alter table public.extension_usage
    add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.extension_usage
    add column if not exists admin_name text;

create table if not exists public.extension_user_entitlements (
    user_id uuid primary key references auth.users(id) on delete cascade,
    features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.extension_entitlement_audit (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    feature_key text not null,
    previous_enabled boolean not null,
    enabled boolean not null,
    actor_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists extension_entitlement_audit_created_idx
    on public.extension_entitlement_audit (created_at desc);

create table if not exists public.extension_feedback (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    email text not null,
    category text not null check (category in ('feature', 'bug', 'other')),
    title text not null check (char_length(title) between 1 and 120),
    message text not null check (char_length(message) between 1 and 4000),
    status text not null default 'new' check (status in ('new', 'reviewing', 'planned', 'done', 'declined')),
    public_board boolean not null default false,
    created_at timestamptz not null default now(),
    check (email = lower(email))
);

alter table public.extension_feedback
    add column if not exists public_board boolean not null default false;

create table if not exists public.extension_feedback_votes (
    feedback_id uuid not null references public.extension_feedback(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (feedback_id, user_id)
);

create table if not exists public.extension_feedback_activity (
    id uuid primary key default gen_random_uuid(),
    feedback_id uuid not null references public.extension_feedback(id) on delete cascade,
    actor_id uuid references auth.users(id) on delete set null,
    old_status text,
    new_status text not null check (new_status in ('new', 'reviewing', 'planned', 'done', 'declined')),
    created_at timestamptz not null default now()
);

create index if not exists extension_feedback_activity_feedback_created_idx
    on public.extension_feedback_activity (feedback_id, created_at);
create index if not exists extension_feedback_public_board_created_idx
    on public.extension_feedback (created_at desc)
    where category = 'feature' and public_board;

create or replace function public.log_extension_feedback_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
        return new;
    end if;

    insert into public.extension_feedback_activity (feedback_id, actor_id, old_status, new_status)
    values (
        new.id,
        (select auth.uid()),
        case when tg_op = 'INSERT' then null else old.status end,
        new.status
    );
    return new;
end;
$$;

drop trigger if exists extension_feedback_activity_log on public.extension_feedback;
create trigger extension_feedback_activity_log
    after insert or update of status on public.extension_feedback
    for each row execute function public.log_extension_feedback_activity();

create or replace function public.get_public_feature_requests()
returns table (
    id uuid,
    title text,
    status text,
    created_at timestamptz,
    vote_count bigint,
    has_voted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        f.id,
        f.title,
        f.status,
        f.created_at,
        count(v.user_id) as vote_count,
        coalesce(bool_or(v.user_id = (select auth.uid())), false) as has_voted
    from public.extension_feedback f
    left join public.extension_feedback_votes v on v.feedback_id = f.id
    where f.category = 'feature'
      and f.public_board
      and f.status <> 'declined'
    group by f.id, f.title, f.status, f.created_at
    order by count(v.user_id) desc, f.created_at desc
    limit 100;
$$;

create or replace function public.toggle_extension_feedback_vote(p_feedback_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    affected_rows integer;
begin
    if current_user_id is null then
        raise exception 'Sign in to vote' using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.extension_feedback
        where id = p_feedback_id
          and category = 'feature'
          and public_board
          and status <> 'declined'
    ) then
        raise exception 'Feature request not found' using errcode = '22023';
    end if;

    delete from public.extension_feedback_votes
    where feedback_id = p_feedback_id and user_id = current_user_id;
    get diagnostics affected_rows = row_count;

    if affected_rows > 0 then
        return false;
    end if;

    insert into public.extension_feedback_votes (feedback_id, user_id)
    values (p_feedback_id, current_user_id);
    return true;
end;
$$;

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

drop function if exists public.record_extension_usage(uuid, text);
create or replace function public.record_extension_usage(
    p_install_id uuid,
    p_version text,
    p_admin_name text default null
)
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
    if p_admin_name is not null
       and (char_length(btrim(p_admin_name)) not between 1 and 64) then
        raise exception 'Invalid admin name' using errcode = '22023';
    end if;

    insert into public.extension_usage (install_id, user_id, version, admin_name, first_seen_at, last_seen_at)
    values (p_install_id, (select auth.uid()), p_version, nullif(btrim(p_admin_name), ''), now(), now())
    on conflict (install_id) do update
        set version = excluded.version,
            user_id = excluded.user_id,
            admin_name = excluded.admin_name,
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

create or replace function public.get_my_extension_entitlements()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    user_features jsonb;
    changed_at timestamptz;
begin
    if current_user_id is null then
        raise exception 'Sign in to view feature access' using errcode = '42501';
    end if;

    select features, updated_at
    into user_features, changed_at
    from public.extension_user_entitlements
    where user_id = current_user_id;

    return jsonb_build_object(
        'features', coalesce(user_features, '{}'::jsonb),
        'updated_at', changed_at
    );
end;
$$;

create or replace function public.set_extension_user_feature(
    p_user_id uuid,
    p_feature_key text,
    p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    previous_value boolean := false;
begin
    if not public.is_extension_owner() then
        raise exception 'Not authorized' using errcode = '42501';
    end if;
    if p_user_id is null or p_enabled is null
       or p_feature_key is null
       or p_feature_key !~ '^[a-z][a-z0-9_]{1,63}$' then
        raise exception 'Enter a valid user ID, feature key, and access state' using errcode = '22023';
    end if;

    select coalesce((
        select (features ->> p_feature_key)::boolean
        from public.extension_user_entitlements
        where user_id = p_user_id
    ), false) into previous_value;

    insert into public.extension_user_entitlements (user_id, features, updated_at, updated_by)
    values (
        p_user_id,
        jsonb_build_object(p_feature_key, p_enabled),
        now(),
        (select auth.uid())
    )
    on conflict (user_id) do update
        set features = jsonb_set(
                public.extension_user_entitlements.features,
                array[p_feature_key],
                to_jsonb(p_enabled),
                true
            ),
            updated_at = now(),
            updated_by = (select auth.uid());

    insert into public.extension_entitlement_audit (
        user_id, feature_key, previous_enabled, enabled, actor_id
    ) values (
        p_user_id, p_feature_key, previous_value, p_enabled, (select auth.uid())
    );
end;
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
        'daily_installs',
        coalesce((
            select jsonb_agg(jsonb_build_object('day', day, 'installs', installs) order by day)
            from (
                select first_seen_at::date as day, count(*) as installs
                from public.extension_usage
                where first_seen_at >= now() - interval '29 days'
                group by first_seen_at::date
            ) daily_counts
        ), '[]'::jsonb),
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
        ), '[]'::jsonb),
        'identified_admins',
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'admin_name', admin_name,
                'user_id', user_id,
                'version', version,
                'last_seen_at', last_seen_at
            ) order by last_seen_at desc)
            from (
                select admin_name, user_id, version, last_seen_at
                from public.extension_usage
                where admin_name is not null
                order by last_seen_at desc
                limit 100
            ) identified_installations
        ), '[]'::jsonb)
    ) into stats;

    return stats;
end;
$$;

revoke all on function public.is_extension_staff() from public;
revoke all on function public.is_extension_owner() from public;
revoke all on function public.record_extension_usage(uuid, text, text) from public;
revoke all on function public.opt_out_extension_usage(uuid) from public;
revoke all on function public.get_my_extension_entitlements() from public;
revoke all on function public.set_extension_user_feature(uuid, text, boolean) from public;
revoke all on function public.get_extension_usage_stats() from public;
revoke all on function public.log_extension_feedback_activity() from public;
revoke all on function public.get_public_feature_requests() from public;
revoke all on function public.toggle_extension_feedback_vote(uuid) from public;
grant execute on function public.is_extension_staff() to anon, authenticated;
grant execute on function public.is_extension_owner() to authenticated;
grant execute on function public.record_extension_usage(uuid, text, text) to anon, authenticated;
grant execute on function public.opt_out_extension_usage(uuid) to anon, authenticated;
grant execute on function public.get_my_extension_entitlements() to authenticated;
grant execute on function public.set_extension_user_feature(uuid, text, boolean) to authenticated;
grant execute on function public.get_extension_usage_stats() to authenticated;
grant execute on function public.get_public_feature_requests() to anon, authenticated;
grant execute on function public.toggle_extension_feedback_vote(uuid) to authenticated;

alter table public.extension_staff enable row level security;
alter table public.extension_access_requests enable row level security;
alter table public.extension_announcements enable row level security;
alter table public.extension_releases enable row level security;
alter table public.extension_usage enable row level security;
alter table public.extension_user_entitlements enable row level security;
alter table public.extension_entitlement_audit enable row level security;
alter table public.extension_feedback enable row level security;
alter table public.extension_feedback_votes enable row level security;
alter table public.extension_feedback_activity enable row level security;

grant select on public.extension_announcements, public.extension_releases to anon, authenticated;
grant insert, update, delete on public.extension_announcements, public.extension_releases to authenticated;
grant select, insert, update, delete on public.extension_staff, public.extension_access_requests to authenticated;
revoke all on public.extension_usage from public, anon, authenticated;
revoke all on public.extension_user_entitlements, public.extension_entitlement_audit from public, anon, authenticated;
grant select on public.extension_user_entitlements, public.extension_entitlement_audit to authenticated;
revoke all on public.extension_feedback from public, anon, authenticated;
grant select, insert on public.extension_feedback to authenticated;
grant update (status) on public.extension_feedback to authenticated;
revoke all on public.extension_feedback_votes from public, anon, authenticated;
revoke all on public.extension_feedback_activity from public, anon, authenticated;
grant select on public.extension_feedback_activity to authenticated;

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

drop policy if exists "Users can read own entitlements and owners can read all" on public.extension_user_entitlements;
create policy "Users can read own entitlements and owners can read all"
    on public.extension_user_entitlements for select to authenticated
    using (user_id = (select auth.uid()) or public.is_extension_owner());
drop policy if exists "Owners can read entitlement audit" on public.extension_entitlement_audit;
create policy "Owners can read entitlement audit"
    on public.extension_entitlement_audit for select to authenticated
    using (public.is_extension_owner());

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

drop policy if exists "Users can read own feedback activity and staff can read all" on public.extension_feedback_activity;
create policy "Users can read own feedback activity and staff can read all"
    on public.extension_feedback_activity for select to authenticated
    using (
        exists (
            select 1
            from public.extension_feedback
            where id = feedback_id
              and (user_id = (select auth.uid()) or public.is_extension_staff())
        )
    );

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
