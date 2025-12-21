-- ==============================================
-- FULL SETUP SCRIPT FOR SRI LANKA REPO OPS
-- Run this ONCE in Supabase SQL Editor
-- ==============================================

-- =====================
-- PART 1: SCHEMA
-- =====================

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
  collateral_status text not null default 'N/A',
  collateral_completed_at timestamptz,
  collateral_completed_by uuid references auth.users(id),
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
  coverage_method text not null default 'HAIRCUT_VALUE',
  coverage_buffer_pct numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.config_settings
    add column if not exists repo_security_type_codes text not null default 'srlk,lrlk';
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.config_settings
    add column if not exists default_day_count_basis int not null default 365;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.config_settings
    add column if not exists day_count_method text not null default 'ACT/365';
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.config_settings
    add column if not exists include_maturity boolean not null default false;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.config_settings
    add column if not exists use_holiday_calendar boolean not null default false;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.config_settings
    add column if not exists holiday_roll text not null default 'FOLLOWING';
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.config_settings
    add column if not exists coverage_method text not null default 'HAIRCUT_VALUE';
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.config_settings
    add column if not exists coverage_buffer_pct numeric(10,6) not null default 0;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.rollover_batch_items
    add column if not exists collateral_status text not null default 'N/A';
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.rollover_batch_items
    add column if not exists collateral_completed_at timestamptz;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.rollover_batch_items
    add column if not exists collateral_completed_by uuid references auth.users(id);
exception when duplicate_column then null; end $$;

create table if not exists public.org_holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  holiday_date date not null,
  description text,
  created_at timestamptz not null default now(),
  unique (org_id, holiday_date)
);

-- Counterparty Limits for exposure management
create table if not exists public.counterparty_limits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  counterparty_id uuid not null references public.counterparties(id) on delete cascade,
  limit_type text not null default 'TOTAL_EXPOSURE', -- TOTAL_EXPOSURE, SINGLE_TRADE, COLLATERAL
  limit_amount numeric(20,2) not null,
  warning_threshold_pct numeric(5,2) not null default 80.00, -- Alert at 80% utilization
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, counterparty_id, limit_type)
);

-- Collateral market prices for revaluation
create table if not exists public.collateral_prices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  security_id uuid not null references public.securities(id) on delete cascade,
  price_date date not null,
  clean_price numeric(18,8) not null,
  dirty_price numeric(18,8),
  yield numeric(12,8),
  source text not null default 'MANUAL', -- MANUAL, BLOOMBERG, REUTERS, FILE_UPLOAD
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, security_id, price_date)
);

-- Ledger entries for accounting
do $$ begin
  create type public.ledger_entry_type as enum ('PRINCIPAL','INTEREST_ACCRUAL','INTEREST_RECEIVED','INTEREST_PAID','COLLATERAL_IN','COLLATERAL_OUT','FEE','ADJUSTMENT');
exception when duplicate_object then null; end $$;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo_allocation_id uuid references public.repo_allocations(id) on delete set null,
  portfolio_id uuid references public.portfolios(id),
  counterparty_id uuid references public.counterparties(id),
  entry_date date not null,
  value_date date not null,
  entry_type public.ledger_entry_type not null,
  debit_amount numeric(20,2) not null default 0,
  credit_amount numeric(20,2) not null default 0,
  currency text not null default 'LKR',
  description text,
  reference_number text,
  is_reversed boolean not null default false,
  reversed_by_id uuid references public.ledger_entries(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_repo_trades_org_maturity on public.repo_trades(org_id, maturity_date);
create index if not exists idx_repo_allocations_org_portfolio on public.repo_allocations(org_id, portfolio_id);
create index if not exists idx_collateral_positions_org_portfolio on public.collateral_positions(org_id, portfolio_id);
create index if not exists idx_collateral_substitutions_org_allocation on public.collateral_substitutions(org_id, repo_allocation_id);
create index if not exists idx_rollover_items_batch on public.rollover_batch_items(batch_id);
create index if not exists idx_org_holidays_date on public.org_holidays(org_id, holiday_date);
create index if not exists idx_portfolio_groups_org on public.portfolio_groups(org_id);
create index if not exists idx_portfolio_group_members_group on public.portfolio_group_members(group_id);
create index if not exists idx_counterparty_limits_org on public.counterparty_limits(org_id, counterparty_id);
create index if not exists idx_collateral_prices_org_date on public.collateral_prices(org_id, price_date);
create index if not exists idx_collateral_prices_security on public.collateral_prices(security_id, price_date);
create index if not exists idx_ledger_entries_org_date on public.ledger_entries(org_id, entry_date);
create index if not exists idx_ledger_entries_allocation on public.ledger_entries(repo_allocation_id);

-- =====================
-- PART 2: FUNCTIONS
-- =====================

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer as $$
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

create or replace function public.guard_repo_trade_status()
returns trigger language plpgsql as $$
declare
  role_name public.user_role;
begin
  if new.status is distinct from old.status then
    if new.status in ('APPROVED', 'POSTED') then
      role_name := public.current_user_role(new.org_id);
      if role_name not in ('BO_OPERATIONS','OPS_SUPERVISOR') then
        raise exception 'Only BO/OPS can update repo trade status to %', new.status;
      end if;
      if old.created_by is not null and old.created_by = auth.uid() then
        raise exception 'Maker-checker: trade creator cannot approve/post own trade';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_repo_trade_status on public.repo_trades;
create trigger trg_guard_repo_trade_status
before update on public.repo_trades
for each row execute function public.guard_repo_trade_status();

create or replace function public.set_allocations_active_on_trade_posted()
returns trigger language plpgsql as $$
begin
  if new.status = 'POSTED' and new.status is distinct from old.status then
    update public.repo_allocations
    set status = 'ACTIVE'
    where repo_trade_id = new.id
      and status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_repo_trade_posted_activate_allocations on public.repo_trades;
create trigger trg_repo_trade_posted_activate_allocations
after update on public.repo_trades
for each row execute function public.set_allocations_active_on_trade_posted();

create or replace function public.guard_repo_allocation_status()
returns trigger language plpgsql as $$
declare
  role_name public.user_role;
  trade_creator uuid;
begin
  if new.status is distinct from old.status then
    if new.status in ('APPROVED', 'POSTED', 'ACTIVE', 'MATURED', 'CLOSED', 'ROLLED', 'CANCELLED') then
      role_name := public.current_user_role(new.org_id);
      if role_name not in ('BO_OPERATIONS','OPS_SUPERVISOR') then
        raise exception 'Only BO/OPS can update repo allocation status to %', new.status;
      end if;
      select created_by into trade_creator
      from public.repo_trades
      where id = new.repo_trade_id;
      if trade_creator is not null and trade_creator = auth.uid() then
        raise exception 'Maker-checker: trade creator cannot update allocation status to %', new.status;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_repo_allocation_status on public.repo_allocations;
create trigger trg_guard_repo_allocation_status
before update on public.repo_allocations
for each row execute function public.guard_repo_allocation_status();

create or replace function public.mark_rollover_collateral_complete()
returns trigger language plpgsql as $$
begin
  update public.rollover_batch_items
  set collateral_status = 'COMPLETE',
      collateral_completed_at = coalesce(collateral_completed_at, now()),
      collateral_completed_by = coalesce(collateral_completed_by, auth.uid())
  where new_repo_allocation_id = new.repo_allocation_id
    and collateral_status in ('REQUIRED', 'PENDING');

  return new;
end;
$$;

drop trigger if exists trg_mark_rollover_collateral_complete on public.collateral_positions;
create trigger trg_mark_rollover_collateral_complete
after insert on public.collateral_positions
for each row execute function public.mark_rollover_collateral_complete();

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
    cs.day_count_method,
    cs.include_maturity,
    cs.use_holiday_calendar,
    cs.holiday_roll,
    cs.default_day_count_basis
  into cfg
  from public.config_settings cs
  where cs.org_id = p_org_id;

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

create or replace view public.collateral_coverage as
select
  alloc.org_id,
  alloc.id as repo_allocation_id,
  alloc.portfolio_id,
  alloc.principal,
  calc.interest_val as expected_interest,
  (alloc.principal + calc.interest_val) as maturity_proceeds,
  coalesce(sum(cp.market_value), 0) as total_market_value,
  coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0) as total_haircut_value,
  case
    when upper(cfg.coverage_method) = 'BUFFER_PCT'
      then (alloc.principal + calc.interest_val) * (1 + coalesce(cfg.coverage_buffer_pct, 0))
    else (alloc.principal + calc.interest_val)
  end as required_collateral_value,
  case
    when upper(cfg.coverage_method) = 'BUFFER_PCT'
      then coalesce(sum(cp.market_value), 0)
    else coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0)
  end as coverage_basis_value,
  case
    when (alloc.principal + calc.interest_val) > 0 then
      case
        when upper(cfg.coverage_method) = 'BUFFER_PCT'
          then coalesce(sum(cp.market_value), 0)
            / ((alloc.principal + calc.interest_val) * (1 + coalesce(cfg.coverage_buffer_pct, 0)))
        else coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0)
            / (alloc.principal + calc.interest_val)
      end
    else null
  end as coverage_ratio,
  case
    when upper(cfg.coverage_method) = 'BUFFER_PCT' then
      greatest(
        ((alloc.principal + calc.interest_val) * (1 + coalesce(cfg.coverage_buffer_pct, 0)))
          - coalesce(sum(cp.market_value), 0),
        0
      )
    else
      greatest(
        (alloc.principal + calc.interest_val)
          - coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0),
        0
      )
  end as shortfall,
  case
    when upper(cfg.coverage_method) = 'BUFFER_PCT' then
      greatest(
        coalesce(sum(cp.market_value), 0)
          - ((alloc.principal + calc.interest_val) * (1 + coalesce(cfg.coverage_buffer_pct, 0))),
        0
      )
    else
      greatest(
        coalesce(sum(cp.market_value * (1 - coalesce(cp.haircut_pct, 0))), 0)
          - (alloc.principal + calc.interest_val),
        0
      )
  end as excess
from public.repo_allocations alloc
join public.repo_trades trade on trade.id = alloc.repo_trade_id
join public.config_settings cfg on cfg.org_id = alloc.org_id
left join public.collateral_positions cp
  on cp.repo_allocation_id = alloc.id
  and cp.status in ('RECEIVED', 'ACTIVE')
cross join lateral (
  select public.compute_repo_interest_config(
    alloc.org_id,
    alloc.principal,
    trade.rate,
    trade.issue_date,
    trade.maturity_date,
    trade.day_count_basis
  ) as interest_val
) calc
group by
  alloc.org_id,
  alloc.id,
  alloc.portfolio_id,
  alloc.principal,
  calc.interest_val,
  cfg.coverage_method,
  cfg.coverage_buffer_pct;

-- Counterparty Exposure View with Limit Utilization
create or replace view public.counterparty_exposure as
select
  cp.org_id,
  cp.id as counterparty_id,
  cp.name as counterparty_name,
  cp.short_code,
  coalesce(sum(case when alloc.status in ('ACTIVE','APPROVED','POSTED') then alloc.principal else 0 end), 0) as total_principal_exposure,
  coalesce(sum(case when alloc.status in ('ACTIVE','APPROVED','POSTED') then alloc.principal else 0 end), 0) 
    + coalesce((
      select sum(ra.accrued_interest)
      from public.repo_accruals ra
      join public.repo_allocations a2 on a2.id = ra.repo_allocation_id
      join public.repo_trades rt2 on rt2.id = a2.repo_trade_id
      where rt2.counterparty_id = cp.id and a2.status in ('ACTIVE','APPROVED','POSTED')
    ), 0) as total_exposure_with_interest,
  count(distinct case when alloc.status in ('ACTIVE','APPROVED','POSTED') then alloc.id end) as active_allocation_count,
  coalesce(lim.limit_amount, 0) as exposure_limit,
  lim.warning_threshold_pct,
  case
    when lim.limit_amount > 0 then
      round(
        coalesce(sum(case when alloc.status in ('ACTIVE','APPROVED','POSTED') then alloc.principal else 0 end), 0)
        / lim.limit_amount * 100, 2
      )
    else null
  end as utilization_pct,
  case
    when lim.limit_amount is null then 'NO_LIMIT'
    when coalesce(sum(case when alloc.status in ('ACTIVE','APPROVED','POSTED') then alloc.principal else 0 end), 0) > lim.limit_amount then 'BREACH'
    when lim.limit_amount > 0 and (coalesce(sum(case when alloc.status in ('ACTIVE','APPROVED','POSTED') then alloc.principal else 0 end), 0) / lim.limit_amount * 100) >= coalesce(lim.warning_threshold_pct, 80) then 'WARNING'
    else 'OK'
  end as limit_status
from public.counterparties cp
left join public.repo_trades rt on rt.counterparty_id = cp.id
left join public.repo_allocations alloc on alloc.repo_trade_id = rt.id
left join public.counterparty_limits lim on lim.counterparty_id = cp.id
  and lim.limit_type = 'TOTAL_EXPOSURE'
  and lim.is_active = true
  and current_date between lim.effective_from and coalesce(lim.effective_to, '9999-12-31')
where cp.is_active = true
group by cp.org_id, cp.id, cp.name, cp.short_code, lim.limit_amount, lim.warning_threshold_pct;

-- Daily Accrual Generation Function
create or replace function public.run_daily_accruals(p_org_id uuid, p_accrual_date date default current_date)
returns table(allocations_processed int, accruals_created int, errors_count int)
language plpgsql security definer as $$
declare
  v_alloc record;
  v_processed int := 0;
  v_created int := 0;
  v_errors int := 0;
  v_daily_interest numeric(20,2);
  v_days_in_period int;
  v_total_interest numeric(20,2);
begin
  -- Process all active allocations for the org
  for v_alloc in
    select
      alloc.id as allocation_id,
      alloc.principal,
      trade.rate,
      trade.issue_date,
      trade.maturity_date,
      trade.day_count_basis
    from public.repo_allocations alloc
    join public.repo_trades trade on trade.id = alloc.repo_trade_id
    where alloc.org_id = p_org_id
      and alloc.status in ('ACTIVE', 'POSTED', 'APPROVED')
      and p_accrual_date between trade.issue_date and trade.maturity_date
  loop
    v_processed := v_processed + 1;
    
    begin
      -- Calculate days in period
      v_days_in_period := v_alloc.maturity_date - v_alloc.issue_date;
      if v_days_in_period <= 0 then
        v_days_in_period := 1;
      end if;
      
      -- Calculate total interest for the period
      v_total_interest := public.compute_repo_interest_config(
        p_org_id,
        v_alloc.principal,
        v_alloc.rate,
        v_alloc.issue_date,
        v_alloc.maturity_date,
        v_alloc.day_count_basis
      );
      
      -- Calculate daily interest (straight-line)
      v_daily_interest := round(v_total_interest / v_days_in_period, 2);
      
      -- Insert accrual (upsert to avoid duplicates)
      insert into public.repo_accruals (org_id, repo_allocation_id, accrual_date, accrued_interest)
      values (p_org_id, v_alloc.allocation_id, p_accrual_date, v_daily_interest)
      on conflict (org_id, repo_allocation_id, accrual_date)
      do update set accrued_interest = excluded.accrued_interest;
      
      v_created := v_created + 1;
      
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;
  
  return query select v_processed, v_created, v_errors;
end;
$$;

-- Function to revalue collateral positions using latest prices
create or replace function public.revalue_collateral(p_org_id uuid, p_valuation_date date default current_date)
returns table(positions_updated int, total_market_value numeric)
language plpgsql security definer as $$
declare
  v_updated int := 0;
  v_total numeric(20,2) := 0;
  v_position record;
  v_new_price numeric(18,8);
  v_new_market_value numeric(20,2);
begin
  -- Update each collateral position with latest price
  for v_position in
    select cp.id, cp.collateral_security_id, cp.face_value
    from public.collateral_positions cp
    where cp.org_id = p_org_id
      and cp.status in ('RECEIVED', 'ACTIVE')
  loop
    -- Get the latest price for this security (on or before valuation date)
    select dirty_price into v_new_price
    from public.collateral_prices
    where org_id = p_org_id
      and security_id = v_position.collateral_security_id
      and price_date <= p_valuation_date
    order by price_date desc
    limit 1;
    
    if v_new_price is not null then
      v_new_market_value := v_position.face_value * v_new_price / 100;
      
      update public.collateral_positions
      set dirty_price = v_new_price,
          market_value = v_new_market_value,
          valuation_date = p_valuation_date
      where id = v_position.id;
      
      v_updated := v_updated + 1;
      v_total := v_total + v_new_market_value;
    end if;
  end loop;
  
  return query select v_updated, v_total;
end;
$$;

-- Function to create ledger entries for a repo allocation
create or replace function public.create_repo_ledger_entries(
  p_allocation_id uuid,
  p_entry_date date default current_date
)
returns void
language plpgsql security definer as $$
declare
  v_alloc record;
begin
  select
    alloc.org_id,
    alloc.portfolio_id,
    alloc.principal,
    trade.counterparty_id,
    trade.direction
  into v_alloc
  from public.repo_allocations alloc
  join public.repo_trades trade on trade.id = alloc.repo_trade_id
  where alloc.id = p_allocation_id;
  
  if v_alloc is null then
    raise exception 'Allocation not found';
  end if;
  
  -- Create principal entry based on direction
  if v_alloc.direction = 'CASH_LENDER' then
    -- We lend cash, debit investment account
    insert into public.ledger_entries (
      org_id, repo_allocation_id, portfolio_id, counterparty_id,
      entry_date, value_date, entry_type, debit_amount, credit_amount,
      description, reference_number
    ) values (
      v_alloc.org_id, p_allocation_id, v_alloc.portfolio_id, v_alloc.counterparty_id,
      p_entry_date, p_entry_date, 'PRINCIPAL', v_alloc.principal, 0,
      'Repo principal disbursement', 'REPO-' || p_allocation_id::text
    );
  else
    -- We borrow cash, credit liability account
    insert into public.ledger_entries (
      org_id, repo_allocation_id, portfolio_id, counterparty_id,
      entry_date, value_date, entry_type, debit_amount, credit_amount,
      description, reference_number
    ) values (
      v_alloc.org_id, p_allocation_id, v_alloc.portfolio_id, v_alloc.counterparty_id,
      p_entry_date, p_entry_date, 'PRINCIPAL', 0, v_alloc.principal,
      'Repo principal receipt', 'REPO-' || p_allocation_id::text
    );
  end if;
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
  old_repo_trade_id uuid;
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
  old_repo_trade_id := nullif(batch_rec.params->>'old_repo_trade_id', '')::uuid;

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
    and (old_repo_trade_id is null or alloc.repo_trade_id = old_repo_trade_id)
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
  collateral_status text;
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
            collateral_status = 'N/A',
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

      collateral_status := case
        when item_rec.collateral_mode = 'REUSE' then 'COMPLETE'
        when item_rec.collateral_mode = 'REPLACE' then 'REQUIRED'
        when item_rec.collateral_mode = 'PENDING' then 'PENDING'
        else 'N/A'
      end;

      if item_rec.collateral_mode = 'REUSE'
        and item_rec.new_counterparty_id is not null
        and item_rec.new_counterparty_id <> old_trade.counterparty_id then
        collateral_status := 'REQUIRED';
      end if;

      update public.rollover_batch_items
      set status = 'SUCCESS',
          new_repo_trade_id = new_trade_id,
          new_repo_allocation_id = new_allocation_id,
          collateral_status = collateral_status
      where id = item_rec.id;

      if item_rec.collateral_mode = 'REUSE' then
        if item_rec.new_counterparty_id is not null
          and item_rec.new_counterparty_id <> old_trade.counterparty_id then
          update public.rollover_batch_items
          set error_message = coalesce(error_message, 'Counterparty change requires collateral replace')
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
      elsif item_rec.collateral_mode = 'REPLACE' then
        update public.rollover_batch_items
        set error_message = coalesce(error_message, 'Collateral replace required')
        where id = item_rec.id;
      elsif item_rec.collateral_mode = 'PENDING' then
        update public.rollover_batch_items
        set error_message = coalesce(error_message, 'Collateral pending confirmation')
        where id = item_rec.id;
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

-- =====================
-- PART 3: ENABLE RLS
-- =====================

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
alter table public.counterparty_limits enable row level security;
alter table public.collateral_prices enable row level security;
alter table public.ledger_entries enable row level security;

-- =====================
-- PART 4: RLS POLICIES
-- =====================

-- Orgs
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs for select
using (exists (select 1 from public.org_members m where m.org_id = orgs.id and m.user_id = auth.uid()));

-- Org members (use direct auth.uid() check to avoid recursion)
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select using (user_id = auth.uid());
drop policy if exists org_members_modify on public.org_members;
create policy org_members_modify on public.org_members for insert with check (user_id = auth.uid());

-- Profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (auth.uid() = user_id);
drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles for insert with check (auth.uid() = user_id);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Counterparties
drop policy if exists counterparties_select on public.counterparties;
create policy counterparties_select on public.counterparties for select using (public.is_org_member(org_id));
drop policy if exists counterparties_insert on public.counterparties;
create policy counterparties_insert on public.counterparties for insert with check (public.is_org_member(org_id));
drop policy if exists counterparties_update on public.counterparties;
create policy counterparties_update on public.counterparties for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Security types
drop policy if exists security_types_select on public.security_types;
create policy security_types_select on public.security_types for select using (public.is_org_member(org_id));
drop policy if exists security_types_insert on public.security_types;
create policy security_types_insert on public.security_types for insert with check (public.is_org_member(org_id));
drop policy if exists security_types_update on public.security_types;
create policy security_types_update on public.security_types for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Securities
drop policy if exists securities_select on public.securities;
create policy securities_select on public.securities for select using (public.is_org_member(org_id));
drop policy if exists securities_insert on public.securities;
create policy securities_insert on public.securities for insert with check (public.is_org_member(org_id));
drop policy if exists securities_update on public.securities;
create policy securities_update on public.securities for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Portfolios
drop policy if exists portfolios_select on public.portfolios;
create policy portfolios_select on public.portfolios for select using (public.is_org_member(org_id));
drop policy if exists portfolios_insert on public.portfolios;
create policy portfolios_insert on public.portfolios for insert with check (public.is_org_member(org_id));
drop policy if exists portfolios_update on public.portfolios;
create policy portfolios_update on public.portfolios for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Portfolio groups
drop policy if exists portfolio_groups_select on public.portfolio_groups;
create policy portfolio_groups_select on public.portfolio_groups for select using (public.is_org_member(org_id));
drop policy if exists portfolio_groups_insert on public.portfolio_groups;
create policy portfolio_groups_insert on public.portfolio_groups for insert with check (public.is_org_member(org_id));
drop policy if exists portfolio_groups_update on public.portfolio_groups;
create policy portfolio_groups_update on public.portfolio_groups for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists portfolio_group_members_select on public.portfolio_group_members;
create policy portfolio_group_members_select on public.portfolio_group_members for select using (public.is_org_member(org_id));
drop policy if exists portfolio_group_members_insert on public.portfolio_group_members;
create policy portfolio_group_members_insert on public.portfolio_group_members for insert with check (public.is_org_member(org_id));
drop policy if exists portfolio_group_members_update on public.portfolio_group_members;
create policy portfolio_group_members_update on public.portfolio_group_members for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists portfolio_group_members_delete on public.portfolio_group_members;
create policy portfolio_group_members_delete on public.portfolio_group_members for delete using (public.is_org_member(org_id));

drop policy if exists portfolio_groups_delete on public.portfolio_groups;
create policy portfolio_groups_delete on public.portfolio_groups for delete using (public.is_org_member(org_id));

-- Cash accounts
drop policy if exists cash_accounts_select on public.cash_accounts;
create policy cash_accounts_select on public.cash_accounts for select using (public.is_org_member(org_id));
drop policy if exists cash_accounts_insert on public.cash_accounts;
create policy cash_accounts_insert on public.cash_accounts for insert with check (public.is_org_member(org_id));
drop policy if exists cash_accounts_update on public.cash_accounts;
create policy cash_accounts_update on public.cash_accounts for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Custody accounts
drop policy if exists custody_accounts_select on public.custody_accounts;
create policy custody_accounts_select on public.custody_accounts for select using (public.is_org_member(org_id));
drop policy if exists custody_accounts_insert on public.custody_accounts;
create policy custody_accounts_insert on public.custody_accounts for insert with check (public.is_org_member(org_id));
drop policy if exists custody_accounts_update on public.custody_accounts;
create policy custody_accounts_update on public.custody_accounts for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Repo trades
drop policy if exists repo_trades_select on public.repo_trades;
create policy repo_trades_select on public.repo_trades for select using (public.is_org_member(org_id));
drop policy if exists repo_trades_insert on public.repo_trades;
create policy repo_trades_insert on public.repo_trades for insert with check (public.is_org_member(org_id));
drop policy if exists repo_trades_update on public.repo_trades;
create policy repo_trades_update on public.repo_trades for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Repo allocations
drop policy if exists repo_allocations_select on public.repo_allocations;
create policy repo_allocations_select on public.repo_allocations for select using (public.is_org_member(org_id));
drop policy if exists repo_allocations_insert on public.repo_allocations;
create policy repo_allocations_insert on public.repo_allocations for insert with check (public.is_org_member(org_id));
drop policy if exists repo_allocations_update on public.repo_allocations;
create policy repo_allocations_update on public.repo_allocations for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Repo accruals
drop policy if exists repo_accruals_select on public.repo_accruals;
create policy repo_accruals_select on public.repo_accruals for select using (public.is_org_member(org_id));
drop policy if exists repo_accruals_insert on public.repo_accruals;
create policy repo_accruals_insert on public.repo_accruals for insert with check (public.is_org_member(org_id));
drop policy if exists repo_accruals_update on public.repo_accruals;
create policy repo_accruals_update on public.repo_accruals for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Collateral positions
drop policy if exists collateral_positions_select on public.collateral_positions;
create policy collateral_positions_select on public.collateral_positions for select using (public.is_org_member(org_id));
drop policy if exists collateral_positions_insert on public.collateral_positions;
create policy collateral_positions_insert on public.collateral_positions for insert with check (public.is_org_member(org_id));
drop policy if exists collateral_positions_update on public.collateral_positions;
create policy collateral_positions_update on public.collateral_positions for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Collateral substitutions
drop policy if exists collateral_substitutions_select on public.collateral_substitutions;
create policy collateral_substitutions_select on public.collateral_substitutions for select using (public.is_org_member(org_id));
drop policy if exists collateral_substitutions_insert on public.collateral_substitutions;
create policy collateral_substitutions_insert on public.collateral_substitutions for insert with check (public.is_org_member(org_id));
drop policy if exists collateral_substitutions_update on public.collateral_substitutions;
create policy collateral_substitutions_update on public.collateral_substitutions for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Rollover batches
drop policy if exists rollover_batches_select on public.rollover_batches;
create policy rollover_batches_select on public.rollover_batches for select using (public.is_org_member(org_id));
drop policy if exists rollover_batches_insert on public.rollover_batches;
create policy rollover_batches_insert on public.rollover_batches for insert with check (public.is_org_member(org_id));
drop policy if exists rollover_batches_update on public.rollover_batches;
create policy rollover_batches_update on public.rollover_batches for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Rollover batch items
drop policy if exists rollover_batch_items_select on public.rollover_batch_items;
create policy rollover_batch_items_select on public.rollover_batch_items for select using (public.is_org_member(org_id));
drop policy if exists rollover_batch_items_insert on public.rollover_batch_items;
create policy rollover_batch_items_insert on public.rollover_batch_items for insert with check (public.is_org_member(org_id));
drop policy if exists rollover_batch_items_update on public.rollover_batch_items;
create policy rollover_batch_items_update on public.rollover_batch_items for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Audit log
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select using (public.is_org_member(org_id));
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert with check (public.is_org_member(org_id));

-- Config settings
drop policy if exists config_settings_select on public.config_settings;
create policy config_settings_select on public.config_settings for select using (public.is_org_member(org_id));
drop policy if exists config_settings_insert on public.config_settings;
create policy config_settings_insert on public.config_settings for insert with check (public.is_org_member(org_id));
drop policy if exists config_settings_update on public.config_settings;
create policy config_settings_update on public.config_settings for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Org holidays
drop policy if exists org_holidays_select on public.org_holidays;
create policy org_holidays_select on public.org_holidays for select using (public.is_org_member(org_id));
drop policy if exists org_holidays_insert on public.org_holidays;
create policy org_holidays_insert on public.org_holidays for insert with check (public.is_org_member(org_id));
drop policy if exists org_holidays_update on public.org_holidays;
create policy org_holidays_update on public.org_holidays for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists org_holidays_delete on public.org_holidays;
create policy org_holidays_delete on public.org_holidays for delete using (public.is_org_member(org_id));

-- Counterparty Limits
drop policy if exists counterparty_limits_select on public.counterparty_limits;
create policy counterparty_limits_select on public.counterparty_limits for select using (public.is_org_member(org_id));
drop policy if exists counterparty_limits_insert on public.counterparty_limits;
create policy counterparty_limits_insert on public.counterparty_limits for insert with check (public.is_org_member(org_id));
drop policy if exists counterparty_limits_update on public.counterparty_limits;
create policy counterparty_limits_update on public.counterparty_limits for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists counterparty_limits_delete on public.counterparty_limits;
create policy counterparty_limits_delete on public.counterparty_limits for delete using (public.is_org_member(org_id));

-- Collateral Prices
drop policy if exists collateral_prices_select on public.collateral_prices;
create policy collateral_prices_select on public.collateral_prices for select using (public.is_org_member(org_id));
drop policy if exists collateral_prices_insert on public.collateral_prices;
create policy collateral_prices_insert on public.collateral_prices for insert with check (public.is_org_member(org_id));
drop policy if exists collateral_prices_update on public.collateral_prices;
create policy collateral_prices_update on public.collateral_prices for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists collateral_prices_delete on public.collateral_prices;
create policy collateral_prices_delete on public.collateral_prices for delete using (public.is_org_member(org_id));

-- Ledger Entries
drop policy if exists ledger_entries_select on public.ledger_entries;
create policy ledger_entries_select on public.ledger_entries for select using (public.is_org_member(org_id));
drop policy if exists ledger_entries_insert on public.ledger_entries;
create policy ledger_entries_insert on public.ledger_entries for insert with check (public.is_org_member(org_id));
drop policy if exists ledger_entries_update on public.ledger_entries;
create policy ledger_entries_update on public.ledger_entries for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- =====================
-- PART 5: CREATE DEMO USER
-- =====================

INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud
) VALUES (
  'dddd1111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'demo@repo.local',
  crypt('Demo123!', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"display_name": "Demo User"}',
  now(),
  now(),
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO UPDATE SET
  email_confirmed_at = now(),
  updated_at = now();

-- Create identity for the user
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  created_at,
  updated_at,
  last_sign_in_at
) VALUES (
  'dddd1111-1111-1111-1111-111111111111',
  'dddd1111-1111-1111-1111-111111111111',
  '{"sub": "dddd1111-1111-1111-1111-111111111111", "email": "demo@repo.local"}',
  'email',
  'demo@repo.local',
  now(),
  now(),
  now()
) ON CONFLICT (provider, provider_id) DO NOTHING;

-- =====================
-- PART 6: SEED DATA
-- =====================

-- Create organization
INSERT INTO public.orgs (id, name) 
VALUES ('11111111-1111-1111-1111-111111111111', 'Demo Asset Management')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Link user to organization
INSERT INTO public.org_members (org_id, user_id, role)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'dddd1111-1111-1111-1111-111111111111',
  'FO_TRADER'
) ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- Create config settings
INSERT INTO public.config_settings (
  org_id,
  repo_security_type_codes,
  default_day_count_basis,
  day_count_method,
  include_maturity,
  use_holiday_calendar,
  holiday_roll,
  coverage_method,
  coverage_buffer_pct
)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'srlk,lrlk',
  365,
  'ACT/365',
  false,
  false,
  'FOLLOWING',
  'HAIRCUT_VALUE',
  0
)
ON CONFLICT (org_id) DO UPDATE SET 
  repo_security_type_codes = EXCLUDED.repo_security_type_codes,
  default_day_count_basis = EXCLUDED.default_day_count_basis,
  day_count_method = EXCLUDED.day_count_method,
  include_maturity = EXCLUDED.include_maturity,
  use_holiday_calendar = EXCLUDED.use_holiday_calendar,
  holiday_roll = EXCLUDED.holiday_roll,
  coverage_method = EXCLUDED.coverage_method,
  coverage_buffer_pct = EXCLUDED.coverage_buffer_pct;

-- Create counterparties
INSERT INTO public.counterparties (org_id, name, short_code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Bank of Ceylon', 'BOC'),
  ('11111111-1111-1111-1111-111111111111', 'People''s Bank', 'PB'),
  ('11111111-1111-1111-1111-111111111111', 'Commercial Bank', 'COMB'),
  ('11111111-1111-1111-1111-111111111111', 'Hatton National Bank', 'HNB'),
  ('11111111-1111-1111-1111-111111111111', 'Sampath Bank', 'SAMP')
ON CONFLICT (org_id, short_code) DO UPDATE SET name = EXCLUDED.name;

-- Create security types
INSERT INTO public.security_types (org_id, code, name, is_repo_type) VALUES
  ('11111111-1111-1111-1111-111111111111', 'srlk', 'Short-term Repo (LKR)', true),
  ('11111111-1111-1111-1111-111111111111', 'lrlk', 'Long-term Repo (LKR)', true),
  ('11111111-1111-1111-1111-111111111111', 'tbill', 'Treasury Bill', false),
  ('11111111-1111-1111-1111-111111111111', 'tbond', 'Treasury Bond', false)
ON CONFLICT (org_id, code) DO UPDATE SET 
  name = EXCLUDED.name,
  is_repo_type = EXCLUDED.is_repo_type;

-- Create portfolios
INSERT INTO public.portfolios (id, org_id, code, name) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'PF-001', 'Growth Fund Alpha'),
  ('aaaa2222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'PF-002', 'Income Fund Beta'),
  ('aaaa3333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'PF-003', 'Balanced Fund Gamma'),
  ('aaaa4444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'PF-004', 'Money Market Fund')
ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name;

-- Create portfolio group
INSERT INTO public.portfolio_groups (id, org_id, name)
VALUES (
  'bbbb1111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'All Portfolios'
)
ON CONFLICT (org_id, name) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.portfolio_group_members (org_id, group_id, portfolio_id)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111'),
  ('11111111-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111', 'aaaa2222-2222-2222-2222-222222222222'),
  ('11111111-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111', 'aaaa3333-3333-3333-3333-333333333333'),
  ('11111111-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111', 'aaaa4444-4444-4444-4444-444444444444')
ON CONFLICT (group_id, portfolio_id) DO NOTHING;

-- Create cash accounts
INSERT INTO public.cash_accounts (org_id, portfolio_id, bank_name, account_no, currency) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 'Bank of Ceylon', 'BOC-001-LKR', 'LKR'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa2222-2222-2222-2222-222222222222', 'Bank of Ceylon', 'BOC-002-LKR', 'LKR'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa3333-3333-3333-3333-333333333333', 'Commercial Bank', 'COMB-003-LKR', 'LKR'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa4444-4444-4444-4444-444444444444', 'People''s Bank', 'PB-004-LKR', 'LKR')
ON CONFLICT DO NOTHING;

-- Create custody accounts
INSERT INTO public.custody_accounts (org_id, portfolio_id, provider, account_no) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 'CBSL_LankaSecure', 'LS-001'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa2222-2222-2222-2222-222222222222', 'CBSL_LankaSecure', 'LS-002'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa3333-3333-3333-3333-333333333333', 'CBSL_LankaSecure', 'LS-003'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa4444-4444-4444-4444-444444444444', 'CBSL_LankaSecure', 'LS-004')
ON CONFLICT DO NOTHING;

-- ==============================================
-- SETUP COMPLETE!
-- ==============================================
-- 
-- Login credentials:
--   Email: demo@repo.local
--   Password: Demo123!
--
-- ==============================================
