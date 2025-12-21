-- STEP 1: Create Schema Only
-- Run this first in Supabase SQL Editor

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

-- Indexes
create index if not exists idx_repo_trades_org_maturity on public.repo_trades(org_id, maturity_date);
create index if not exists idx_repo_allocations_org_portfolio on public.repo_allocations(org_id, portfolio_id);
create index if not exists idx_collateral_positions_org_portfolio on public.collateral_positions(org_id, portfolio_id);
create index if not exists idx_collateral_substitutions_org_allocation on public.collateral_substitutions(org_id, repo_allocation_id);
create index if not exists idx_rollover_items_batch on public.rollover_batch_items(batch_id);
create index if not exists idx_org_holidays_date on public.org_holidays(org_id, holiday_date);
create index if not exists idx_portfolio_groups_org on public.portfolio_groups(org_id);
create index if not exists idx_portfolio_group_members_group on public.portfolio_group_members(group_id);

-- Success message
SELECT 'STEP 1 COMPLETE: Schema created!' as status;

