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
  plan text not null default 'free' check (plan in ('free', 'weekly', 'basic', 'premium')),
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

-- Plans:
--   free     10 leads once (the trial), nothing after that.
--   weekly   the balance is set to 100 at the start of each 7-day week (older plan, kept for existing members).
--   basic    the balance is set to 300 at the start of each 30-day month. One lead uses one credit, on the website and in the CLI.
--   premium  the same 300 a month on the website, and leads found with the CLI are free (the member's own AI does the work).
-- Unused leads do not carry over. When a paid plan ends, the account goes back to free.
alter table public.profiles add column if not exists month_started timestamptz;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'weekly', 'basic', 'premium'));

create or replace function public.refresh_plan(uid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set plan = 'free'
  where id = uid and plan <> 'free' and plan_until is not null and plan_until < now();
  update public.profiles set credits = 100, week_started = now()
  where id = uid and plan = 'weekly'
    and (week_started is null or week_started <= now() - interval '7 days');
  update public.profiles set credits = 300, month_started = now()
  where id = uid and plan in ('basic', 'premium')
    and (month_started is null or month_started <= now() - interval '30 days');
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

-- Start or extend the basic or premium plan for `months` months of 30 days (0 ends it now).
create or replace function public.admin_set_plan(target_email text, new_plan text, months integer) returns void
language plpgsql security definer set search_path = public as $$
declare uid text;
begin
  perform public.assert_admin();
  if new_plan not in ('basic', 'premium') then raise exception 'Plan must be basic or premium'; end if;
  uid := public.account_by_email(target_email);
  if uid is null then raise exception 'No account with that email'; end if;
  if months <= 0 then
    update public.profiles set plan = 'free', plan_until = null where id = uid;
  else
    update public.profiles set
      plan_until = case when plan = new_plan then greatest(coalesce(plan_until, now()), now()) else now() end
        + make_interval(days => 30 * months),
      month_started = case when plan in ('basic', 'premium') then month_started else null end,
      plan = new_plan
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
revoke all on function public.admin_set_plan(text, text, integer) from public, anon;
revoke all on function public.admin_set_key(text, text) from public, anon;
grant execute on function public.current_user_id() to authenticated;
grant execute on function public.my_account() to authenticated;
grant execute on function public.charge_credits(integer) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_weekly(text, integer) to authenticated;
grant execute on function public.admin_add_credits(text, integer) to authenticated;
grant execute on function public.admin_set_plan(text, text, integer) to authenticated;
grant execute on function public.admin_set_key(text, text) to authenticated;


-- ---------- Setup answers, goals and dashboard settings (one row per user) ----------
-- Filled by the setup tour after sign-up and changed later from the dashboard.
-- Username and email come from Clerk on the server, never from the browser.

create table if not exists public.user_setup (
  user_id text primary key references public.profiles (id) on delete cascade,
  username text,
  email text,
  industries text[] not null default '{}',
  ideal_customer text not null default '',
  cities text[] not null default '{}',
  leads_per_week integer not null default 50 check (leads_per_week between 1 and 10000),
  meetings_per_month integer not null default 8 check (meetings_per_month between 0 and 1000),
  deal_size numeric not null default 0 check (deal_size >= 0),
  currency text not null default 'SAR',
  close_rate integer not null default 10 check (close_rate between 0 and 100),
  sales_cycle integer not null default 1 check (sales_cycle between 0 and 3),
  connectors text[] not null default '{}',
  features text[] not null default '{}',
  setup_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_setup enable row level security;
drop policy if exists "own setup" on public.user_setup;
create policy "own setup" on public.user_setup for all
  using (user_id = public.current_user_id()) with check (user_id = public.current_user_id());
grant select, insert, update on public.user_setup to authenticated;

-- Client lists the user imports (CSV) or creates by hand. Lists from Masar searches live in public.searches.
create table if not exists public.client_lists (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  source text not null default 'manual' check (source in ('csv', 'manual')),
  columns text[] not null default '{}',
  rows jsonb not null default '[]',
  row_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_lists_user_idx on public.client_lists (user_id, updated_at desc);
alter table public.client_lists enable row level security;
drop policy if exists "own lists" on public.client_lists;
create policy "own lists" on public.client_lists for all
  using (user_id = public.current_user_id()) with check (user_id = public.current_user_id());
grant select, insert, update, delete on public.client_lists to authenticated;

-- Feedback from the small box at the end of the dashboard. Users can add, only admins can read.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  rating integer check (rating between 1 and 5),
  message text not null default '' check (char_length(message) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "add own feedback" on public.feedback;
create policy "add own feedback" on public.feedback for insert with check (user_id = public.current_user_id());
drop policy if exists "admins read feedback" on public.feedback;
create policy "admins read feedback" on public.feedback for select
  using (exists (select 1 from public.profiles where id = public.current_user_id() and is_admin));
grant select, insert on public.feedback to authenticated;


-- ---------- Masar CLI: sign-in from the terminal, connected computers and usage ----------
-- The CLI runs on the member's own computer with their own AI (Claude, Codex, Ollama…).
-- It signs in with a one-time code the member approves on the website, then holds a long-lived token.
-- Only the website's server touches these tables (service role key); the browser reads its own rows.

-- One row per sign-in attempt. The CLI keeps device_code secret; the member types or clicks user_code.
create table if not exists public.cli_device_codes (
  device_hash text primary key,
  user_code text not null unique,
  user_id text references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used')),
  client_name text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.cli_device_codes enable row level security;

-- One row per signed-in computer. Only a SHA-256 hash of the token is kept.
create table if not exists public.cli_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  device_name text not null default '',
  ai_provider text not null default '',
  ai_model text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists cli_tokens_user_idx on public.cli_tokens (user_id, created_at desc);
alter table public.cli_tokens enable row level security;
drop policy if exists "read own cli tokens" on public.cli_tokens;
create policy "read own cli tokens" on public.cli_tokens for select using (user_id = public.current_user_id());
grant select (id, user_id, device_name, ai_provider, ai_model, created_at, last_used_at, revoked_at) on public.cli_tokens to authenticated;

-- One row per CLI search: which AI and agents ran, how much it found, saved and charged.
create table if not exists public.cli_usage (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  token_id uuid references public.cli_tokens (id) on delete set null,
  search_id uuid references public.searches (id) on delete set null,
  ai_provider text not null default '',
  ai_model text not null default '',
  agents text[] not null default '{}',
  leads_found integer not null default 0,
  leads_saved integer not null default 0,
  credits_used integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  web_searches integer not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cli_usage_user_idx on public.cli_usage (user_id, created_at desc);
alter table public.cli_usage enable row level security;
drop policy if exists "read own cli usage" on public.cli_usage;
create policy "read own cli usage" on public.cli_usage for select using (user_id = public.current_user_id());
grant select on public.cli_usage to authenticated;

-- The same as my_account() and charge_credits(), for a user id the server has already checked
-- (from a CLI token). Only the service role can call these.
create or replace function public.account_for(uid text)
returns table (email text, credits integer, plan text, plan_until timestamptz, week_started timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_plan(uid);
  return query select p.email, p.credits, p.plan, p.plan_until, p.week_started from public.profiles p where p.id = uid;
end $$;

create or replace function public.charge_credits_for(uid text, wanted integer) returns integer
language plpgsql security definer set search_path = public as $$
declare have integer; taken integer;
begin
  if wanted is null or wanted <= 0 or uid is null then return 0; end if;
  perform public.refresh_plan(uid);
  select credits into have from public.profiles where id = uid for update;
  taken := least(coalesce(have, 0), wanted);
  update public.profiles set credits = credits - taken where id = uid;
  return taken;
end $$;

revoke all on function public.account_for(text) from public, anon, authenticated;
revoke all on function public.charge_credits_for(text, integer) from public, anon, authenticated;
grant execute on function public.account_for(text) to service_role;
grant execute on function public.charge_credits_for(text, integer) to service_role;


-- ---------- Everything the agents collect, filed by category ----------
-- Every business any collector finds for a search is kept here (stage 'found'); the ones checked and
-- saved to the member's list are marked 'checked'. category = the industry key searched for
-- (or 'custom:<words>'), business_type = the business's own type, sources = which agents found it.
create table if not exists public.collected_leads (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  search_id uuid not null references public.searches (id) on delete cascade,
  lead_key text not null,
  name text not null,
  category text not null,
  business_type text,
  city text not null default '',
  sources text[] not null default '{}',
  stage text not null default 'found' check (stage in ('found', 'checked')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, lead_key)
);
create index if not exists collected_leads_user_category_idx on public.collected_leads (user_id, category, created_at desc);
create index if not exists collected_leads_user_city_idx on public.collected_leads (user_id, city);
alter table public.collected_leads enable row level security;
drop policy if exists "own collected leads" on public.collected_leads;
create policy "own collected leads" on public.collected_leads for all
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id() and exists (
    select 1 from public.searches s where s.id = search_id and s.user_id = public.current_user_id()));
grant select, insert, update, delete on public.collected_leads to authenticated;

-- Saved leads carry the same category, city and sources, so lists can be filtered by them.
alter table public.leads add column if not exists category text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists sources text[] not null default '{}';
create index if not exists leads_user_category_idx on public.leads (user_id, category);
