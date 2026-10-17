-- Fujin Labs referral system: run this once in Supabase -> SQL Editor.
-- The table is locked: the public website can only call the three functions below.

create table if not exists signups (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  company     text,
  phone       text,
  interest    text,
  code        text not null unique,
  referred_by text
);
create unique index if not exists signups_email_key on signups (lower(email));
create index if not exists signups_referred_by_idx on signups (referred_by);

alter table signups enable row level security;   -- no policies = no direct access for the public key

create or replace function join_fujin(p_name text, p_email text, p_company text, p_phone text, p_interest text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_code text; v_ref text := nullif(upper(trim(p_ref)), '');
  v_row signups;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if length(trim(coalesce(p_name,''))) = 0 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid input';
  end if;

  select * into v_row from signups where lower(email) = v_email;
  if found then
    return json_build_object('code', v_row.code, 'existing', true,
      'count', (select count(*) from signups where referred_by = v_row.code));
  end if;

  if v_ref is not null and not exists (select 1 from signups where code = v_ref) then v_ref := null; end if;

  loop
    v_code := 'FUJIN-' || (select string_agg(substr(alphabet, 1 + floor(random()*32)::int, 1), '') from generate_series(1,4));
    exit when not exists (select 1 from signups where code = v_code);
  end loop;

  insert into signups (name, email, company, phone, interest, code, referred_by)
  values (trim(p_name), v_email, nullif(trim(p_company),''), nullif(trim(p_phone),''), p_interest, v_code, v_ref);

  return json_build_object('code', v_code, 'existing', false, 'count', 0);
end $$;

create or replace function my_stats(p_email text)
returns json language sql security definer set search_path = public as $$
  select json_build_object('code', s.code, 'count', (select count(*) from signups where referred_by = s.code))
  from signups s where lower(s.email) = lower(trim(p_email));
$$;

create or replace function check_code(p_code text)
returns text language sql security definer set search_path = public as $$
  select split_part(name, ' ', 1) from signups where code = upper(trim(p_code));
$$;

grant execute on function join_fujin(text,text,text,text,text,text) to anon;
grant execute on function my_stats(text) to anon;
grant execute on function check_code(text) to anon;

-- Your leaderboard / export (run in the SQL editor, or use Table Editor -> Export CSV):
-- select s.name, s.email, s.code, count(r.id) as referrals
-- from signups s left join signups r on r.referred_by = s.code
-- group by s.id order by referrals desc;
