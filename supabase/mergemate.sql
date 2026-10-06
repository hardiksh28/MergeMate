-- MergeMate tables. Safe to run in the MergeCity Supabase project: everything is prefixed mm_
-- and nothing here reads or changes MergeCity's tables.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Re-running is safe.

-- ------------------------------------------------------------------ users
create table if not exists public.mm_users (
  id          bigint primary key,            -- GitHub user id (stable even if they rename)
  login       text not null,
  name        text,
  avatar      text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  sign_ins    int not null default 1
);
create index if not exists mm_users_login on public.mm_users (lower(login));

-- ----------------------------------------------------------------- events
-- One row per thing someone did: signin, onboard, match, start, guess, fix, check, pr, prep, reply
create table if not exists public.mm_events (
  id          bigserial primary key,
  user_id     bigint references public.mm_users (id) on delete set null,
  login       text,                          -- null for anonymous (e.g. landing-page "find my issues")
  kind        text not null,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists mm_events_login_time on public.mm_events (lower(login), created_at);
create index if not exists mm_events_kind_time on public.mm_events (kind, created_at);

-- Row level security ON with no policies: the public anon key can read/write nothing.
-- Only MergeMate's server (service role key) can touch these tables.
alter table public.mm_users enable row level security;
alter table public.mm_events enable row level security;
revoke all on public.mm_users, public.mm_events from anon, authenticated;

-- ---------------------------------------------------------------- functions
-- Upsert a user on sign-in and count the visit.
create or replace function public.mm_touch_user(p_id bigint, p_login text, p_name text, p_avatar text)
returns void language sql security definer set search_path = public as $$
  insert into mm_users (id, login, name, avatar)
  values (p_id, p_login, p_name, p_avatar)
  on conflict (id) do update
    set login = excluded.login, name = excluded.name, avatar = excluded.avatar,
        last_seen = now(), sign_ins = mm_users.sign_ins + 1;
$$;

-- Log an event, capped at 20 per user/kind/day so one busy day can't inflate the graph.
create or replace function public.mm_log_event(p_user_id bigint, p_login text, p_kind text, p_meta jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_login is not null and (
    select count(*) from mm_events
    where lower(login) = lower(p_login) and kind = p_kind and created_at >= date_trunc('day', now())
  ) >= 20 then
    return;
  end if;
  insert into mm_events (user_id, login, kind, meta) values (p_user_id, p_login, p_kind, p_meta);
  if p_user_id is not null then
    update mm_users set last_seen = now() where id = p_user_id;
  end if;
end;
$$;

-- Per-day, per-kind counts for one user's public activity graph (last 371 days).
create or replace function public.mm_user_activity(p_login text)
returns table (day date, kind text, n int) language sql stable security definer set search_path = public as $$
  select (created_at at time zone 'utc')::date, kind, count(*)::int
  from mm_events
  where lower(login) = lower(p_login) and created_at >= now() - interval '371 days'
    and kind in ('start', 'guess', 'fix', 'check', 'pr', 'prep', 'reply')
  group by 1, 2;
$$;

-- Everything the admin dashboard needs, in one call.
create or replace function public.mm_admin_stats()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'users', (select count(*) from mm_users),
    'new_today', (select count(*) from mm_users where created_at >= date_trunc('day', now())),
    'new_7d', (select count(*) from mm_users where created_at >= now() - interval '7 days'),
    'active_today', (select count(distinct login) from mm_events where login is not null and created_at >= date_trunc('day', now())),
    'active_7d', (select count(distinct login) from mm_events where login is not null and created_at >= now() - interval '7 days'),
    'by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from mm_events group by kind) k),
    'funnel', json_build_object(
      'signed_in', (select count(*) from mm_users),
      'onboarded', (select count(distinct login) from mm_events where kind = 'onboard'),
      'started', (select count(distinct login) from mm_events where kind = 'start'),
      'fixed', (select count(distinct login) from mm_events where kind = 'fix'),
      'pr', (select count(distinct login) from mm_events where kind = 'pr')
    ),
    'daily', (
      select json_agg(json_build_object('day', d, 'signups', s, 'active', a, 'prs', p, 'lookups', l) order by d)
      from (
        select g::date d,
          (select count(*) from mm_users u where u.created_at::date = g::date) s,
          (select count(distinct login) from mm_events e where e.login is not null and e.created_at::date = g::date) a,
          (select count(*) from mm_events e where e.kind = 'pr' and e.created_at::date = g::date) p,
          (select count(*) from mm_events e where e.kind = 'match' and e.created_at::date = g::date) l
        from generate_series(current_date - 29, current_date, interval '1 day') g
      ) x
    ),
    'people', (
      select coalesce(json_agg(p order by p.last_seen desc), '[]'::json) from (
        select u.login, u.name, u.avatar, u.created_at, u.last_seen, u.sign_ins,
          (select count(*) from mm_events e where e.user_id = u.id and e.kind = 'start') starts,
          (select count(*) from mm_events e where e.user_id = u.id and e.kind = 'pr') prs,
          (select count(*) from mm_events e where e.user_id = u.id) actions
        from mm_users u order by u.last_seen desc limit 500
      ) p
    ),
    'recent', (
      select coalesce(json_agg(r), '[]'::json) from (
        select login, kind, meta, created_at from mm_events order by created_at desc limit 60
      ) r
    )
  );
$$;

-- Functions are callable by everyone by default in Postgres; lock them to the server.
revoke execute on function public.mm_touch_user(bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.mm_log_event(bigint, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.mm_user_activity(text) from public, anon, authenticated;
revoke execute on function public.mm_admin_stats() from public, anon, authenticated;
