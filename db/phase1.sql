-- Phase 1 schema, RLS, and seed data for Sri Lanka Repo app.
create extension if not exists "pgcrypto";

do $$ begin
  create type public.user_role as enum ('FO_TRADER','BO_OPERATIONS','RISK_COMPLIANCE','OPS_SUPERVISOR','READ_ONLY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.security_status as enum ('UNSUPERVISED','PENDING_BO_APPROVAL','APPROVED','INACTIVE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.repo_direction as enum ('CASH_LENDER','CASH_BORROWER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.repo_status as enum ('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','ACTIVE','MATURED','CLOSED','ROLLED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rollover_mode as enum ('MASS','SINGLE','UPLOAD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.batch_status as enum ('DRAFT','SUBMITTED','APPROVED','RUNNING','COMPLETED','FAILED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.batch_status add value if not exists 'APPROVED';
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.batch_item_status as enum ('PENDING','SUCCESS','FAILED','SKIPPED');
exception when duplicate_object then null; end $$;

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  short_code text not null,
  is_active boolean not null default true,
  default_collateral_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, short_code)
);

create table if not exists public.security_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  code text not null,
  name text not null,
  is_repo_type boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table if not exists public.securities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  security_type_id uuid not null references public.security_types(id),
  symbol text not null,
  isin text,
  name text not null,
  issuer text,
  counterparty_id uuid references public.counterparties(id),
  issue_date date,
  maturity_date date,
  rate numeric(12,8),
  day_count_basis int,
  status public.security_status not null default 'UNSUPERVISED',
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, symbol)
);

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  code text not null,
  name text not null,
  base_currency text not null default 'LKR',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table if not exists public.portfolio_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists public.portfolio_group_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid not null references public.portfolio_groups(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, portfolio_id)
);

create table if not exists public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  currency text not null default 'LKR',
  bank_name text,
  account_no text,
  created_at timestamptz not null default now()
);

create table if not exists public.custody_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  provider text not null default 'CBSL_LankaSecure',
  account_no text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.repo_trades (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo_security_id uuid not null references public.securities(id),
  counterparty_id uuid not null references public.counterparties(id),
  direction public.repo_direction not null default 'CASH_LENDER',
  issue_date date not null,
  maturity_date date not null,
  rate numeric(12,8) not null,
  day_count_basis int not null default 365,
  status public.repo_status not null default 'DRAFT',
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  posted_at timestamptz,
  external_ref text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.repo_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo_trade_id uuid not null references public.repo_trades(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id),
  cash_account_id uuid references public.cash_accounts(id),
  custody_account_id uuid references public.custody_accounts(id),
  lot_location text,
  principal numeric(20,2) not null,
  reinvest_interest boolean not null default true,
  capital_adjustment numeric(20,2) not null default 0,
  status public.repo_status not null default 'ACTIVE',
  maturity_interest numeric(20,2),
  maturity_proceeds numeric(20,2),
  created_at timestamptz not null default now()
);

create table if not exists public.repo_accruals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo_allocation_id uuid not null references public.repo_allocations(id) on delete cascade,
  accrual_date date not null,
  accrued_interest numeric(20,2) not null,
  created_at timestamptz not null default now(),
  unique (org_id, repo_allocation_id, accrual_date)
);

create table if not exists public.collateral_positions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo_allocation_id uuid not null references public.repo_allocations(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id),
  collateral_security_id uuid not null references public.securities(id),
  face_value numeric(20,2) not null,
  dirty_price numeric(20,8),
  market_value numeric(20,2) not null,
  haircut_pct numeric(10,6) not null default 0,
  valuation_date date not null,
  restricted_flag boolean not null default true,
  status text not null default 'RECEIVED',
  external_custodian_ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.collateral_substitutions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo_allocation_id uuid not null references public.repo_allocations(id) on delete cascade,
  old_collateral_id uuid references public.collateral_positions(id),
  new_collateral_id uuid references public.collateral_positions(id),
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace view public.collateral_coverage as
select
  alloc.org_id,
  alloc.id as repo_allocation_id,
  alloc.portfolio_id,
  alloc.principal,
  coalesce(sum(cp.market_value), 0) as total_market_value,
  coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0) as total_haircut_value,
  case
    when alloc.principal > 0
      then coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0) / alloc.principal
    else null
  end as coverage_ratio,
  greatest(alloc.principal - coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0), 0) as shortfall,
  greatest(coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0) - alloc.principal, 0) as excess
from public.repo_allocations alloc
left join public.collateral_positions cp
  on cp.repo_allocation_id = alloc.id
  and cp.status in ('RECEIVED', 'ACTIVE')
group by alloc.org_id, alloc.id, alloc.portfolio_id, alloc.principal;

create table if not exists public.rollover_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  mode public.rollover_mode not null,
  rollover_date date not null,
  portfolio_selector text,
  params jsonb not null default '{}'::jsonb,
  status public.batch_status not null default 'DRAFT',
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.rollover_batch_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  batch_id uuid not null references public.rollover_batches(id) on delete cascade,
  old_repo_allocation_id uuid not null references public.repo_allocations(id),
  portfolio_id uuid not null references public.portfolios(id),
  principal numeric(20,2) not null,
  interest numeric(20,2) not null,
  maturity_proceeds numeric(20,2) not null,
  reinvest_interest boolean not null default true,
  capital_adjustment numeric(20,2) not null default 0,
  new_invest_amount numeric(20,2) not null,
  new_rate numeric(12,8),
  new_maturity_date date,
  new_counterparty_id uuid references public.counterparties(id),
  new_security_type_id uuid references public.security_types(id),
  collateral_mode text not null default 'REUSE',
  new_repo_trade_id uuid references public.repo_trades(id),
  new_repo_allocation_id uuid references public.repo_allocations(id),
  status public.batch_item_status not null default 'PENDING',
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.config_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  repo_security_type_codes text not null default 'srlk,lrlk',
  default_day_count_basis int not null default 365,
  day_count_method text not null default 'ACT/365',
  include_maturity boolean not null default false,
  use_holiday_calendar boolean not null default false,
  holiday_roll text not null default 'FOLLOWING',
  created_at timestamptz not null default now()
);

create table if not exists public.org_holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  holiday_date date not null,
  description text,
  created_at timestamptz not null default now(),
  unique (org_id, holiday_date)
);

create index if not exists idx_repo_trades_org_maturity on public.repo_trades(org_id, maturity_date);
create index if not exists idx_repo_allocations_org_portfolio on public.repo_allocations(org_id, portfolio_id);
create index if not exists idx_collateral_positions_org_portfolio on public.collateral_positions(org_id, portfolio_id);
create index if not exists idx_collateral_substitutions_org_allocation on public.collateral_substitutions(org_id, repo_allocation_id);
create index if not exists idx_rollover_items_batch on public.rollover_batch_items(batch_id);
create index if not exists idx_org_holidays_date on public.org_holidays(org_id, holiday_date);
create index if not exists idx_portfolio_groups_org on public.portfolio_groups(org_id);
create index if not exists idx_portfolio_group_members_group on public.portfolio_group_members(group_id);

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.current_user_role(p_org_id uuid)
returns public.user_role
language sql stable as $$
  select role
  from public.org_members
  where org_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.guard_security_approval()
returns trigger language plpgsql as $$
begin
  if (new.status = 'APPROVED' and old.status <> 'APPROVED') then
    if public.current_user_role(new.org_id) not in ('BO_OPERATIONS','OPS_SUPERVISOR') then
      raise exception 'Only BO/OPS can approve securities';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_security_approval on public.securities;
create trigger trg_guard_security_approval
before update on public.securities
for each row execute function public.guard_security_approval();

create or replace function public.guard_rollover_batch_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('RUNNING', 'COMPLETED', 'FAILED') then
      if public.current_user_role(new.org_id) not in ('BO_OPERATIONS','OPS_SUPERVISOR') then
        raise exception 'Only BO/OPS can update rollover batch status to %', new.status;
      end if;
      if old.created_by is not null and old.created_by = auth.uid() then
        raise exception 'Maker-checker: batch creator cannot execute batch';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_rollover_batch_status on public.rollover_batches;
create trigger trg_guard_rollover_batch_status
before update on public.rollover_batches
for each row execute function public.guard_rollover_batch_status();

create or replace function public.submit_rollover_batch(p_batch_id uuid)
returns void
language plpgsql as $$
declare
  batch_rec record;
begin
  select * into batch_rec
  from public.rollover_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Rollover batch % not found', p_batch_id;
  end if;

  if batch_rec.status <> 'DRAFT' then
    raise exception 'Only DRAFT batches can be submitted';
  end if;

  update public.rollover_batches
  set status = 'SUBMITTED'
  where id = p_batch_id;
end;
$$;

create or replace function public.approve_rollover_batch(p_batch_id uuid)
returns void
language plpgsql as $$
declare
  batch_rec record;
  role_name public.user_role;
begin
  select * into batch_rec
  from public.rollover_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Rollover batch % not found', p_batch_id;
  end if;

  role_name := public.current_user_role(batch_rec.org_id);
  if role_name not in ('BO_OPERATIONS', 'OPS_SUPERVISOR') then
    raise exception 'Only BO/OPS can approve rollover batches';
  end if;

  if batch_rec.created_by is not null and batch_rec.created_by = auth.uid() then
    raise exception 'Maker-checker: batch creator cannot approve batch';
  end if;

  if batch_rec.status <> 'SUBMITTED' then
    raise exception 'Only SUBMITTED batches can be approved';
  end if;

  update public.rollover_batches
  set status = 'APPROVED',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_batch_id;
end;
$$;
create or replace function public.compute_repo_interest(
  p_principal numeric,
  p_rate numeric,
  p_issue_date date,
  p_maturity_date date,
  p_day_count_basis int,
  p_include_maturity boolean default false
)
returns numeric
language plpgsql immutable as $$
declare
  accrual_days int;
begin
  if p_principal is null or p_rate is null or p_issue_date is null or p_maturity_date is null then
    return 0;
  end if;

  accrual_days := (p_maturity_date - p_issue_date);
  if p_include_maturity then
    accrual_days := accrual_days + 1;
  end if;
  if accrual_days < 0 then
    accrual_days := 0;
  end if;

  if p_day_count_basis not in (360, 365) then
    raise exception 'Unsupported day count basis % (expected 360 or 365)', p_day_count_basis;
  end if;

  return round(p_principal * p_rate * (accrual_days::numeric / p_day_count_basis), 2);
end;
$$;

create or replace function public.is_business_day(
  p_org_id uuid,
  p_date date
)
returns boolean
language plpgsql stable as $$
declare
  dow int;
begin
  dow := extract(dow from p_date);
  if dow in (0, 6) then
    return false;
  end if;

  if exists (
    select 1
    from public.org_holidays h
    where h.org_id = p_org_id
      and h.holiday_date = p_date
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.adjust_to_business_day(
  p_org_id uuid,
  p_date date,
  p_roll text
)
returns date
language plpgsql stable as $$
declare
  adjusted date := p_date;
  roll text := upper(coalesce(p_roll, 'FOLLOWING'));
begin
  if roll not in ('FOLLOWING', 'PRECEDING') then
    raise exception 'Unsupported holiday roll %', roll;
  end if;

  while not public.is_business_day(p_org_id, adjusted) loop
    if roll = 'FOLLOWING' then
      adjusted := adjusted + 1;
    else
      adjusted := adjusted - 1;
    end if;
  end loop;

  return adjusted;
end;
$$;

create or replace function public.compute_accrual_days(
  p_issue_date date,
  p_maturity_date date,
  p_include_maturity boolean,
  p_day_count_method text
)
returns int
language plpgsql immutable as $$
declare
  method text := upper(coalesce(p_day_count_method, 'ACT'));
  d1 int;
  d2 int;
  m1 int;
  m2 int;
  y1 int;
  y2 int;
  accrual_days int;
begin
  if method in ('ACT/360', 'ACT/365', 'ACT') then
    accrual_days := (p_maturity_date - p_issue_date);
  elsif method = '30/360' then
    d1 := extract(day from p_issue_date);
    d2 := extract(day from p_maturity_date);
    m1 := extract(month from p_issue_date);
    m2 := extract(month from p_maturity_date);
    y1 := extract(year from p_issue_date);
    y2 := extract(year from p_maturity_date);

    if d1 = 31 then
      d1 := 30;
    end if;
    if d2 = 31 and d1 = 30 then
      d2 := 30;
    end if;

    accrual_days := (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
  else
    raise exception 'Unsupported day count method %', method;
  end if;

  if p_include_maturity then
    accrual_days := accrual_days + 1;
  end if;

  if accrual_days < 0 then
    accrual_days := 0;
  end if;

  return accrual_days;
end;
$$;

create or replace function public.compute_repo_interest_config(
  p_org_id uuid,
  p_principal numeric,
  p_rate numeric,
  p_issue_date date,
  p_maturity_date date,
  p_day_count_basis int
)
returns numeric
language plpgsql stable as $$
declare
  cfg record;
  method text;
  include_maturity boolean;
  use_holiday_calendar boolean;
  holiday_roll text;
  adjusted_maturity date := p_maturity_date;
  accrual_days int;
  basis int;
begin
  select
    day_count_method,
    include_maturity,
    use_holiday_calendar,
    holiday_roll,
    default_day_count_basis
  into cfg
  from public.config_settings
  where org_id = p_org_id;

  method := coalesce(cfg.day_count_method, case when cfg.default_day_count_basis = 360 then 'ACT/360' else 'ACT/365' end);
  include_maturity := coalesce(cfg.include_maturity, false);
  use_holiday_calendar := coalesce(cfg.use_holiday_calendar, false);
  holiday_roll := coalesce(cfg.holiday_roll, 'FOLLOWING');

  if use_holiday_calendar then
    adjusted_maturity := public.adjust_to_business_day(p_org_id, p_maturity_date, holiday_roll);
  end if;

  accrual_days := public.compute_accrual_days(p_issue_date, adjusted_maturity, include_maturity, method);

  if method = '30/360' then
    basis := 360;
  elsif p_day_count_basis in (360, 365) then
    basis := p_day_count_basis;
  else
    basis := 365;
  end if;

  return round(p_principal * p_rate * (accrual_days::numeric / basis), 2);
end;
$$;

create or replace function public.build_repo_symbol(
  p_counterparty_id uuid,
  p_issue_date date,
  p_maturity_date date,
  p_rate numeric
)
returns text
language plpgsql stable as $$
declare
  cp_code text;
  rate_pct text;
begin
  select short_code into cp_code
  from public.counterparties
  where id = p_counterparty_id;

  if cp_code is null then
    cp_code := 'REPO';
  end if;

  rate_pct := trim(to_char(p_rate * 100, 'FM9990.00'));

  return concat_ws(
    '-',
    cp_code,
    to_char(p_issue_date, 'YYYYMMDD'),
    to_char(p_maturity_date, 'YYYYMMDD'),
    rate_pct
  );
end;
$$;

create or replace function public.create_rollover_batch(
  p_org_id uuid,
  p_mode public.rollover_mode,
  p_rollover_date date,
  p_portfolio_ids uuid[] default null,
  p_params jsonb default '{}'::jsonb
)
returns uuid
language plpgsql as $$
declare
  batch_id uuid;
  role_name public.user_role;
  params jsonb := p_params;
begin
  role_name := public.current_user_role(p_org_id);
  if role_name is null then
    raise exception 'User is not a member of org %', p_org_id;
  end if;

  if p_portfolio_ids is not null then
    params := jsonb_set(params, '{portfolio_ids}', to_jsonb(p_portfolio_ids), true);
  end if;

  insert into public.rollover_batches (
    org_id,
    mode,
    rollover_date,
    portfolio_selector,
    params,
    status,
    created_by
  )
  values (
    p_org_id,
    p_mode,
    p_rollover_date,
    case when p_portfolio_ids is null then 'ALL' else 'LIST' end,
    params,
    'DRAFT',
    auth.uid()
  )
  returning id into batch_id;

  return batch_id;
end;
$$;

create or replace function public.build_rollover_batch_items(
  p_batch_id uuid
)
returns int
language plpgsql as $$
declare
  batch_rec record;
  portfolio_ids uuid[];
  repo_type_codes text[];
  inserted_count int := 0;
  override_rate numeric;
  override_maturity date;
  override_counterparty uuid;
  override_security_type uuid;
  override_collateral_mode text;
  amount_override numeric;
  group_id uuid;
begin
  select * into batch_rec
  from public.rollover_batches
  where id = p_batch_id;

  if not found then
    raise exception 'Rollover batch % not found', p_batch_id;
  end if;

  select string_to_array(repo_security_type_codes, ',')
    into repo_type_codes
  from public.config_settings
  where org_id = batch_rec.org_id;

  if repo_type_codes is null then
    raise exception 'Config settings missing repo_security_type_codes for org %', batch_rec.org_id;
  end if;

  select array_agg(value::uuid)
    into portfolio_ids
  from jsonb_array_elements_text(coalesce(batch_rec.params->'portfolio_ids', '[]'::jsonb));

  override_rate := nullif(batch_rec.params->>'new_rate', '')::numeric;
  override_maturity := nullif(batch_rec.params->>'new_maturity_date', '')::date;
  override_counterparty := nullif(batch_rec.params->>'new_counterparty_id', '')::uuid;
  override_security_type := nullif(batch_rec.params->>'new_security_type_id', '')::uuid;
  override_collateral_mode := nullif(batch_rec.params->>'collateral_mode', '');
  amount_override := nullif(batch_rec.params->>'amount_override', '')::numeric;
  group_id := nullif(batch_rec.params->>'group_id', '')::uuid;

  if portfolio_ids is null and group_id is not null then
    select array_agg(m.portfolio_id)
      into portfolio_ids
    from public.portfolio_group_members m
    join public.portfolio_groups g on g.id = m.group_id
    where m.group_id = group_id
      and g.org_id = batch_rec.org_id;
  end if;

  if portfolio_ids is not null and array_length(portfolio_ids, 1) = 0 then
    portfolio_ids := null;
  end if;

  if amount_override is not null then
    if amount_override < 0 then
      raise exception 'Amount override must be non-negative';
    end if;
    if portfolio_ids is null or array_length(portfolio_ids, 1) <> 1 then
      raise exception 'Amount override requires a single portfolio selection';
    end if;
  end if;

  insert into public.rollover_batch_items (
    org_id,
    batch_id,
    old_repo_allocation_id,
    portfolio_id,
    principal,
    interest,
    maturity_proceeds,
    reinvest_interest,
    capital_adjustment,
    new_invest_amount,
    new_rate,
    new_maturity_date,
    new_counterparty_id,
    new_security_type_id,
    collateral_mode,
    status
  )
  select
    batch_rec.org_id,
    batch_rec.id,
    alloc.id,
    alloc.portfolio_id,
    alloc.principal,
    calc.interest_val as interest,
    alloc.principal + calc.interest_val as maturity_proceeds,
    alloc.reinvest_interest,
    case
      when amount_override is not null
        then amount_override - (alloc.principal + case when alloc.reinvest_interest then calc.interest_val else 0 end)
      else alloc.capital_adjustment
    end as capital_adjustment,
    case
      when amount_override is not null then amount_override
      else alloc.principal
        + case when alloc.reinvest_interest then calc.interest_val else 0 end
        + alloc.capital_adjustment
    end as new_invest_amount,
    override_rate,
    override_maturity,
    override_counterparty,
    override_security_type,
    coalesce(override_collateral_mode, 'REUSE'),
    'PENDING'
  from public.repo_allocations alloc
  join public.repo_trades trade on trade.id = alloc.repo_trade_id
  join public.securities sec on sec.id = trade.repo_security_id
  join public.security_types st on st.id = sec.security_type_id
  cross join lateral (
    select public.compute_repo_interest_config(
      batch_rec.org_id,
      alloc.principal,
      trade.rate,
      trade.issue_date,
      trade.maturity_date,
      trade.day_count_basis
    ) as interest_val
  ) calc
  where trade.org_id = batch_rec.org_id
    and trade.maturity_date = batch_rec.rollover_date
    and alloc.status in ('ACTIVE', 'POSTED')
    and st.code = any(repo_type_codes)
    and (portfolio_ids is null or alloc.portfolio_id = any(portfolio_ids))
    and not exists (
      select 1
      from public.rollover_batch_items i
      where i.batch_id = batch_rec.id
        and i.old_repo_allocation_id = alloc.id
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.execute_rollover_batch(
  p_batch_id uuid
)
returns void
language plpgsql as $$
declare
  batch_rec record;
  item_rec record;
  old_trade record;
  old_security record;
  target_counterparty_id uuid;
  target_security_type_id uuid;
  target_rate numeric;
  target_maturity_date date;
  tenor_days int;
  new_security_id uuid;
  new_trade_id uuid;
  new_allocation_id uuid;
  security_name text;
  symbol text;
  role_name public.user_role;
begin
  select * into batch_rec
  from public.rollover_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Rollover batch % not found', p_batch_id;
  end if;

  role_name := public.current_user_role(batch_rec.org_id);
  if role_name not in ('BO_OPERATIONS', 'OPS_SUPERVISOR') then
    raise exception 'Only BO/OPS can execute rollover batches';
  end if;

  if batch_rec.status <> 'APPROVED' then
    raise exception 'Rollover batch % must be APPROVED before execution (status %)', p_batch_id, batch_rec.status;
  end if;

  update public.rollover_batches
  set status = 'RUNNING',
      started_at = now(),
      error_message = null
  where id = p_batch_id;

  for item_rec in
    select *
    from public.rollover_batch_items
    where batch_id = p_batch_id
      and status = 'PENDING'
    order by created_at
  loop
    begin
      select trade.*, sec.security_type_id
        into old_trade
      from public.repo_trades trade
      join public.securities sec on sec.id = trade.repo_security_id
      where trade.id = (
        select repo_trade_id
        from public.repo_allocations
        where id = item_rec.old_repo_allocation_id
      );

      if old_trade.id is null then
        raise exception 'Missing repo trade for allocation %', item_rec.old_repo_allocation_id;
      end if;

      if item_rec.new_invest_amount <= 0 then
        update public.repo_allocations
        set status = 'CLOSED',
            maturity_interest = item_rec.interest,
            maturity_proceeds = item_rec.maturity_proceeds
        where id = item_rec.old_repo_allocation_id;

        update public.rollover_batch_items
        set status = 'SKIPPED',
            error_message = 'Zero reinvest amount'
        where id = item_rec.id;
        continue;
      end if;

      target_counterparty_id := coalesce(item_rec.new_counterparty_id, old_trade.counterparty_id);
      target_security_type_id := coalesce(item_rec.new_security_type_id, old_trade.security_type_id);
      target_rate := coalesce(item_rec.new_rate, old_trade.rate);
      tenor_days := (old_trade.maturity_date - old_trade.issue_date);
      target_maturity_date := coalesce(
        item_rec.new_maturity_date,
        batch_rec.rollover_date + tenor_days
      );

      symbol := public.build_repo_symbol(
        target_counterparty_id,
        batch_rec.rollover_date,
        target_maturity_date,
        target_rate
      );

      select name into security_name
      from public.counterparties
      where id = target_counterparty_id;

      if security_name is null then
        security_name := 'Counterparty';
      end if;

      security_name := security_name || ' '
        || to_char(batch_rec.rollover_date, 'YYYY-MM-DD')
        || ' -> ' || to_char(target_maturity_date, 'YYYY-MM-DD')
        || ' @ ' || trim(to_char(target_rate * 100, 'FM9990.00')) || '%';

      select r.id, r.repo_security_id
        into new_trade_id, new_security_id
      from public.repo_trades r
      join public.securities s on s.id = r.repo_security_id
      where r.org_id = batch_rec.org_id
        and r.issue_date = batch_rec.rollover_date
        and r.maturity_date = target_maturity_date
        and r.rate = target_rate
        and r.counterparty_id = target_counterparty_id
        and s.security_type_id = target_security_type_id
        and r.notes = 'Rollover batch ' || batch_rec.id
      limit 1;

      if new_trade_id is null then
        insert into public.securities (
          org_id,
          security_type_id,
          symbol,
          name,
          counterparty_id,
          issue_date,
          maturity_date,
          rate,
          day_count_basis,
          status,
          created_by,
          approved_by,
          approved_at
        )
        values (
          batch_rec.org_id,
          target_security_type_id,
          symbol,
          security_name,
          target_counterparty_id,
          batch_rec.rollover_date,
          target_maturity_date,
          target_rate,
          old_trade.day_count_basis,
          'APPROVED',
          auth.uid(),
          auth.uid(),
          now()
        )
        on conflict (org_id, symbol) do update
          set name = excluded.name
        returning id into new_security_id;

        insert into public.repo_trades (
          org_id,
          repo_security_id,
          counterparty_id,
          direction,
          issue_date,
          maturity_date,
          rate,
          day_count_basis,
          status,
          created_by,
          approved_by,
          approved_at,
          posted_at,
          notes
        )
        values (
          batch_rec.org_id,
          new_security_id,
          target_counterparty_id,
          old_trade.direction,
          batch_rec.rollover_date,
          target_maturity_date,
          target_rate,
          old_trade.day_count_basis,
          'POSTED',
          auth.uid(),
          auth.uid(),
          now(),
          now(),
          'Rollover batch ' || batch_rec.id
        )
        returning id into new_trade_id;
      end if;

      insert into public.repo_allocations (
        org_id,
        repo_trade_id,
        portfolio_id,
        cash_account_id,
        custody_account_id,
        principal,
        reinvest_interest,
        capital_adjustment,
        status
      )
      select
        batch_rec.org_id,
        new_trade_id,
        alloc.portfolio_id,
        alloc.cash_account_id,
        alloc.custody_account_id,
        item_rec.new_invest_amount,
        item_rec.reinvest_interest,
        item_rec.capital_adjustment,
        'ACTIVE'
      from public.repo_allocations alloc
      where alloc.id = item_rec.old_repo_allocation_id
      returning id into new_allocation_id;

      update public.repo_allocations
      set status = 'ROLLED',
          maturity_interest = item_rec.interest,
          maturity_proceeds = item_rec.maturity_proceeds
      where id = item_rec.old_repo_allocation_id;

      update public.rollover_batch_items
      set status = 'SUCCESS',
          new_repo_trade_id = new_trade_id,
          new_repo_allocation_id = new_allocation_id
      where id = item_rec.id;

      if item_rec.collateral_mode = 'REUSE' then
        if item_rec.new_counterparty_id is not null
          and item_rec.new_counterparty_id <> old_trade.counterparty_id then
          update public.rollover_batch_items
          set error_message = 'Counterparty change requires collateral replace'
          where id = item_rec.id;
        else
          insert into public.collateral_positions (
            org_id,
            repo_allocation_id,
            portfolio_id,
            collateral_security_id,
            face_value,
            dirty_price,
            market_value,
            haircut_pct,
            valuation_date,
            restricted_flag,
            status,
            external_custodian_ref
          )
          select
            cp.org_id,
            new_allocation_id,
            cp.portfolio_id,
            cp.collateral_security_id,
            cp.face_value,
            cp.dirty_price,
            cp.market_value,
            cp.haircut_pct,
            batch_rec.rollover_date,
            cp.restricted_flag,
            cp.status,
            cp.external_custodian_ref
          from public.collateral_positions cp
          where cp.repo_allocation_id = item_rec.old_repo_allocation_id;
        end if;
      end if;
    exception when others then
      update public.rollover_batch_items
      set status = 'FAILED',
          error_message = left(sqlerrm, 250)
      where id = item_rec.id;
    end;
  end loop;

  update public.rollover_batches
  set status = 'COMPLETED',
      completed_at = now()
  where id = p_batch_id;
exception when others then
  update public.rollover_batches
  set status = 'FAILED',
      error_message = left(sqlerrm, 500)
  where id = p_batch_id;
  raise;
end;
$$;

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.profiles enable row level security;
alter table public.counterparties enable row level security;
alter table public.security_types enable row level security;
alter table public.securities enable row level security;
alter table public.portfolios enable row level security;
alter table public.portfolio_groups enable row level security;
alter table public.portfolio_group_members enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.custody_accounts enable row level security;
alter table public.repo_trades enable row level security;
alter table public.repo_allocations enable row level security;
alter table public.repo_accruals enable row level security;
alter table public.collateral_positions enable row level security;
alter table public.collateral_substitutions enable row level security;
alter table public.rollover_batches enable row level security;
alter table public.rollover_batch_items enable row level security;
alter table public.audit_log enable row level security;
alter table public.config_settings enable row level security;
alter table public.org_holidays enable row level security;

drop policy if exists orgs_select on public.orgs;
create policy orgs_select
on public.orgs for select
using (exists (
  select 1 from public.org_members m
  where m.org_id = orgs.id and m.user_id = auth.uid()
));

drop policy if exists org_members_select on public.org_members;
create policy org_members_select
on public.org_members for select
using (public.is_org_member(org_id));

drop policy if exists org_members_modify on public.org_members;
create policy org_members_modify
on public.org_members for insert
with check (public.is_org_member(org_id));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select
on public.profiles for select
using (auth.uid() = user_id);

drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert
on public.profiles for insert
with check (auth.uid() = user_id);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update
on public.profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
declare
  v_org_id uuid;
  v_repo_type_id uuid;
begin
  insert into public.orgs (name)
  values ('Sri Lanka Repo Demo Org')
  returning id into v_org_id;

  insert into public.config_settings (
    org_id,
    repo_security_type_codes,
    default_day_count_basis,
    day_count_method,
    include_maturity,
    use_holiday_calendar,
    holiday_roll
  )
  values (v_org_id, 'srlk,lrlk', 365, 'ACT/365', false, false, 'FOLLOWING');

  insert into public.security_types (org_id, code, name, is_repo_type)
  values
    (v_org_id, 'SRLK', 'Sri Lanka Repo Short', true),
    (v_org_id, 'LRLK', 'Sri Lanka Repo Long', true),
    (v_org_id, 'TBOND', 'Government Treasury Bond', false),
    (v_org_id, 'TBILL', 'Treasury Bill', false);

  insert into public.counterparties (org_id, name, short_code)
  values
    (v_org_id, 'Bank of Ceylon', 'BOC'),
    (v_org_id, 'People''s Bank', 'PB');

  insert into public.portfolios (org_id, code, name)
  values
    (v_org_id, 'PF001', 'Sri Lanka Income Fund'),
    (v_org_id, 'PF002', 'Sri Lanka Money Market Fund');

  insert into public.portfolio_groups (org_id, name)
  values (v_org_id, 'All Portfolios')
  on conflict (org_id, name) do nothing;

  insert into public.portfolio_group_members (org_id, group_id, portfolio_id)
  select
    v_org_id,
    g.id,
    p.id
  from public.portfolio_groups g
  join public.portfolios p on p.org_id = v_org_id
  where g.org_id = v_org_id and g.name = 'All Portfolios';

  select id into v_repo_type_id
  from public.security_types
  where org_id = v_org_id and code = 'SRLK'
  limit 1;

  insert into public.securities (
    org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status
  )
  select
    v_org_id,
    v_repo_type_id,
    'BOC-REPO-2025-01-02-2025-01-05',
    'BOC Repo 3D @ 8.50%',
    c.id,
    date '2025-01-02',
    date '2025-01-05',
    0.085,
    365,
    'UNSUPERVISED'
  from public.counterparties c
  where c.org_id = v_org_id and c.short_code = 'BOC'
  limit 1;
end $$;
