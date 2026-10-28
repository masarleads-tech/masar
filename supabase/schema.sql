-- Masar database: accounts, free trial, weekly subscription, saved searches and leads, admin tools.
-- Logins are handled by Clerk; Supabase trusts Clerk's session token (Authentication > Third-party auth > Clerk).
-- Run this once in Supabase: SQL Editor > New query > paste everything > Run.
-- It is safe to run again after an update.

-- The signed-in Clerk user's id (for example 'user_2abc…'), read from the session token.
create or replace function public.current_user_id() returns text
language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '') $$;

create table if not exists public.profiles (
  id text primary key,
  email text,
  credits integer not null default 0 check (credits >= 0),
  trial_given boolean not null default false,
  plan text not null default 'free' check (plan in ('free', 'weekly')),
  plan_until timestamptz,
  week_started timestamptz,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;

-- Users can read their own row. Nobody can change it from the browser:
-- every change goes through the functions below.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (id = public.current_user_id());

-- Weekly plan: the balance is set to 100 at the start of each 7-day week while the plan is active.
-- Unused leads do not carry over. When the plan ends, the account goes back to free.
create or replace function public.refresh_plan(uid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set plan = 'free'
  where id = uid and plan = 'weekly' and plan_until is not null and plan_until < now();
  update public.profiles set credits = 100, week_started = now()
  where id = uid and plan = 'weekly'
    and (week_started is null or week_started <= now() - interval '7 days');
end $$;

-- The signed-in user's account. The first call creates it with the 10-lead free trial.
-- Clerk only finishes a sign-up once the email is confirmed, so every new account here has a confirmed email.
-- The trial is given once per email address, so deleting and re-creating an account does not give another.
create or replace function public.my_account()
returns table (email text, credits integer, plan text, plan_until timestamptz, week_started timestamptz, is_admin boolean)
language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_user_id();
  mail text := lower(nullif(auth.jwt() ->> 'email', ''));
  used boolean;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.profiles p where p.id = me) then
    used := mail is not null and exists (select 1 from public.profiles p where lower(p.email) = mail and p.trial_given);
    insert into public.profiles (id, email, credits, trial_given)
    values (me, mail, case when used then 0 else 10 end, true)
    on conflict (id) do nothing;
  elsif mail is not null then
    update public.profiles p set email = mail where p.id = me and p.email is distinct from mail;
  end if;
  perform public.refresh_plan(me);
  return query select p.email, p.credits, p.plan, p.plan_until, p.week_started, p.is_admin
    from public.profiles p where p.id = me;
end $$;

-- Takes up to `wanted` leads from the signed-in user and returns how many it took.
create or replace function public.charge_credits(wanted integer) returns integer
language plpgsql security definer set search_path = public as $$
declare me text := public.current_user_id(); have integer; taken integer;
begin
  if wanted is null or wanted <= 0 or me is null then return 0; end if;
  perform public.refresh_plan(me);
  select credits into have from public.profiles where id = me for update;
  taken := least(coalesce(have, 0), wanted);
  update public.profiles set credits = credits - taken where id = me;
  return taken;
end $$;

-- ---------- Saved searches and leads (kept in PostgreSQL, per user) ----------

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  brief jsonb not null,
  sources text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists searches_user_idx on public.searches (user_id, created_at desc);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  lead_key text not null,
  data jsonb not null,
  closing integer not null default 0,
  fit integer not null default 0,
  outcome text not null default 'new' check (outcome in ('new', 'contacted', 'meeting', 'won', 'lost')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, lead_key)
);
create index if not exists leads_search_idx on public.leads (search_id, closing desc);
create index if not exists leads_user_idx on public.leads (user_id, updated_at desc);

alter table public.searches enable row level security;
alter table public.leads enable row level security;

drop policy if exists "own searches" on public.searches;
create policy "own searches" on public.searches for all
  using (user_id = public.current_user_id()) with check (user_id = public.current_user_id());

drop policy if exists "own leads" on public.leads;
create policy "own leads" on public.leads for all
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id() and exists (
    select 1 from public.searches s where s.id = search_id and s.user_id = public.current_user_id()));

grant select, insert, update, delete on public.searches, public.leads to authenticated;

-- Each subscriber's own Claude API key, set by the admin. No policies: the browser can never read it.
-- Only the website's server reads it, with the service role key.
create table if not exists public.customer_keys (
  user_id text primary key references public.profiles (id) on delete cascade,
  anthropic_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.customer_keys enable row level security;

-- ---------- Admin tools (only for accounts with is_admin = true) ----------

create or replace function public.assert_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = public.current_user_id() and is_admin) then
    raise exception 'Admins only';
  end if;
end $$;

create or replace function public.admin_list_users()
returns table (email text, credits integer, plan text, plan_until timestamptz, week_started timestamptz, created_at timestamptz, confirmed boolean, key_hint text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query select p.email, p.credits, p.plan, p.plan_until, p.week_started, p.created_at, true,
      case when k.anthropic_key is null then null else '…' || right(k.anthropic_key, 4) end
    from public.profiles p
    left join public.customer_keys k on k.user_id = p.id
    order by p.created_at desc;
end $$;

-- The newest account with this email (an email can have an older, deleted login too).
create or replace function public.account_by_email(target_email text) returns text
language sql stable security definer set search_path = public as $$
  select id from public.profiles where lower(email) = lower(trim(target_email)) order by created_at desc limit 1
$$;

-- Start or extend the weekly plan for `weeks` weeks (0 ends it now).
create or replace function public.admin_set_weekly(target_email text, weeks integer) returns void
language plpgsql security definer set search_path = public as $$
declare uid text;
begin
  perform public.assert_admin();
  uid := public.account_by_email(target_email);
  if uid is null then raise exception 'No account with that email'; end if;
  if weeks <= 0 then
    update public.profiles set plan = 'free', plan_until = null where id = uid;
  else
    update public.profiles set plan = 'weekly',
      plan_until = greatest(coalesce(plan_until, now()), now()) + make_interval(weeks => weeks),
      week_started = case when plan = 'weekly' then week_started else null end
    where id = uid;
    perform public.refresh_plan(uid);
  end if;
end $$;

create or replace function public.admin_add_credits(target_email text, amount integer) returns void
language plpgsql security definer set search_path = public as $$
declare uid text;
begin
  perform public.assert_admin();
  uid := public.account_by_email(target_email);
  if uid is null then raise exception 'No account with that email'; end if;
  update public.profiles set credits = greatest(0, credits + amount) where id = uid;
end $$;

-- Set (or remove, with an empty key) a customer's own Claude API key.
create or replace function public.admin_set_key(target_email text, key text) returns void
language plpgsql security definer set search_path = public as $$
declare uid text;
begin
  perform public.assert_admin();
  uid := public.account_by_email(target_email);
  if uid is null then raise exception 'No account with that email'; end if;
  if coalesce(trim(key), '') = '' then
    delete from public.customer_keys where user_id = uid;
  else
    insert into public.customer_keys (user_id, anthropic_key) values (uid, trim(key))
    on conflict (user_id) do update set anthropic_key = excluded.anthropic_key, updated_at = now();
  end if;
end $$;

revoke all on function public.refresh_plan(text) from public, anon, authenticated;
revoke all on function public.my_account() from public, anon;
revoke all on function public.charge_credits(integer) from public, anon;
revoke all on function public.assert_admin() from public, anon;
revoke all on function public.account_by_email(text) from public, anon, authenticated;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_weekly(text, integer) from public, anon;
revoke all on function public.admin_add_credits(text, integer) from public, anon;
revoke all on function public.admin_set_key(text, text) from public, anon;
grant execute on function public.current_user_id() to authenticated;
grant execute on function public.my_account() to authenticated;
grant execute on function public.charge_credits(integer) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_weekly(text, integer) to authenticated;
grant execute on function public.admin_add_credits(text, integer) to authenticated;
grant execute on function public.admin_set_key(text, text) to authenticated;

-- Make yourself the admin AFTER you have signed up on the site (change the email):
--   update public.profiles set is_admin = true where email = 'you@example.com';
