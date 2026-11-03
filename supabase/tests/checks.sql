-- Checks the database rules in schema.sql: free trial, credits, plans, admin tools and who can see what.
-- Run on a scratch PostgreSQL (never on the live database): see run.sh. Any failed check stops with an error.
\set ON_ERROR_STOP 1
\o /dev/null
create or replace function pg_temp.as_user(uid text, mail text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'email', mail, 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
-- Runs a statement and passes when it is refused.
create or replace function pg_temp.refused(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok: % (%)', what, sqlerrm; return; end;
  raise exception 'FAILED: % was allowed', what;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

select pg_temp.as_user('user_A', 'a@x.com');
set role authenticated;
select pg_temp.ok((select credits from public.my_account()) = 10, 'a new account gets the 10-lead free trial');
select pg_temp.ok(public.charge_credits(3) = 3, 'charging 3 takes 3');
select pg_temp.ok(public.charge_credits(20) = 7, 'charging more than the balance takes only what is left');
select pg_temp.ok((select credits from public.my_account()) = 0, 'the balance never goes below 0');
update public.profiles set credits = 999 where id = 'user_A';
select pg_temp.ok((select credits from public.profiles where id = 'user_A') = 0, 'members cannot change their own credits');
insert into public.searches (user_id, brief) values ('user_A', '{}');
insert into public.leads (search_id, user_id, lead_key, data) select id, 'user_A', 'k1', '{}' from public.searches;
insert into public.collected_leads (user_id, search_id, lead_key, name, category, data) select 'user_A', id, 'k1', 'Cafe', 'cafes', '{}' from public.searches;
insert into public.user_setup (user_id, username) values ('user_A', 'a');
insert into public.client_lists (user_id, name) values ('user_A', 'List');
insert into public.feedback (user_id, rating, message) values ('user_A', 5, 'good');
select pg_temp.refused('select * from public.admin_list_users()', 'a member listing all users');
select pg_temp.refused($q$select public.admin_add_credits('a@x.com', 1000)$q$, 'a member adding credits');
select pg_temp.refused($q$select public.charge_credits_for('user_A', 1)$q$, 'a member calling the server-only charge');
select pg_temp.refused($q$select public.account_by_email('a@x.com')$q$, 'a member looking up accounts by email');
reset role;

select pg_temp.as_user('user_B', 'b@x.com');
set role authenticated;
select pg_temp.ok((select credits from public.my_account()) = 10, 'a second member gets their own trial');
select pg_temp.ok((select count(*) from public.searches) = 0, 'members cannot see others'' searches');
select pg_temp.ok((select count(*) from public.leads) = 0, 'members cannot see others'' leads');
select pg_temp.ok((select count(*) from public.collected_leads) = 0, 'members cannot see others'' collected leads');
select pg_temp.ok((select count(*) from public.user_setup) = 0, 'members cannot see others'' setup');
select pg_temp.ok((select count(*) from public.client_lists) = 0, 'members cannot see others'' lists');
select pg_temp.ok((select count(*) from public.feedback) = 0, 'members cannot read feedback');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'members see only their own profile');
select pg_temp.ok((select count(*) from public.customer_keys) = 0 and (select count(*) from public.cli_device_codes) = 0, 'members cannot read keys or sign-in codes');
reset role;
select set_config('test.search', (select id::text from public.searches limit 1), false);
set role authenticated;
select pg_temp.refused($q$insert into public.leads (search_id, user_id, lead_key, data) values (current_setting('test.search')::uuid, 'user_B', 'k2', '{}')$q$, 'adding a lead to someone else''s search');
reset role;

select pg_temp.as_user('user_A2', 'A@x.com');
set role authenticated;
select pg_temp.ok((select credits from public.my_account()) = 0, 'a new login with the same email gets no second trial');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
select pg_temp.refused('select public.my_account()', 'a visitor reading an account');
select pg_temp.refused('select public.charge_credits(1)', 'a visitor charging credits');
select pg_temp.ok((select count(*) from public.profiles) = 0, 'visitors see no profiles');
reset role;

update public.profiles set is_admin = true where id = 'user_A';
select pg_temp.as_user('user_A', 'a@x.com');
set role authenticated;
select public.admin_set_plan('b@x.com', 'basic', 1);
select public.admin_add_credits('b@x.com', 5);
select pg_temp.ok((select credits from public.admin_list_users() where email = 'b@x.com') = 305, 'admin: Basic gives 300, plus 5 added');
select public.admin_set_key('b@x.com', 'sk-ant-123456789');
select pg_temp.ok((select key_hint from public.admin_list_users() where email = 'b@x.com') = '…6789', 'admin sees only the last 4 characters of a key');
select pg_temp.refused($q$select public.admin_set_plan('nobody@x.com', 'basic', 1)$q$, 'admin: a plan for an unknown email');
select pg_temp.ok((select count(*) from public.feedback) = 1, 'admins can read feedback');
reset role;

set role service_role;
select pg_temp.ok((select plan from public.account_for('user_B')) = 'basic', 'server reads the plan for a CLI member');
select pg_temp.ok(public.charge_credits_for('user_B', 400) = 305, 'server charge for the CLI stops at the balance');
reset role;
update public.profiles set plan_until = now() - interval '1 day' where id = 'user_B';
set role service_role;
select pg_temp.ok((select plan from public.account_for('user_B')) = 'free', 'an ended plan goes back to free');
reset role;
update public.profiles set plan = 'basic', plan_until = now() + interval '20 days', month_started = now() - interval '31 days', credits = 4 where id = 'user_B';
set role service_role;
select pg_temp.ok((select credits from public.account_for('user_B')) = 300, 'a new month refills Basic to 300');
reset role;
\echo 'All database checks passed.'
