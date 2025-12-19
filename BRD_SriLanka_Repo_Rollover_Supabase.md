# BRD — Sri Lanka Repo & Repo Rollover Management (Supabase/Postgres)

**Document type:** Business Requirements Document (BRD)  
**Target build style:** deterministic spec suitable for AI-assisted development (Cursor)  
**Primary market:** Sri Lanka (repo treated operationally like FD/time deposit with collateral into CBSL demat)  
**Primary users:** Fund managers/traders + back office + operations + risk/compliance  

---

## 0. Executive Summary

Sri Lankan repo / reverse repo operations (for asset managers) are often run like **placing money on a short-term deposit with a counterparty**, while **receiving Government securities as collateral into the portfolio’s CBSL/LankaSecure demat account**. At maturity, the investor receives **principal + interest** in cash and **returns collateral**.

This application must:

1. Capture **repo placements** (including **bulk allocation** across many customer portfolios).
2. Capture **collateral baskets** (multiple securities), apply **haircuts**, and track **collateral coverage**.
3. Support **daily rollovers** (mass and single), including Sri Lanka maturity scenarios:
   - End repo
   - Rollover with interest
   - Rollover principal only (withdraw interest)
   - Rollover with partial principal withdrawal
   - Rollover with added capital (with/without interest reinvested)
4. Produce operational and exposure reporting **by counterparty** (investments + collateral).

The system is designed for **Supabase (Postgres + Auth + RLS)**.

---

## 1. Goals and Non-Goals

### 1.1 Goals
- Support repo lifecycle: **Draft → Approval → Posted → Active → Matured → Closed/Rolled**.
- **Bulk create** repo positions for multiple portfolios under one “repo series/security”.
- Attach and manage **collateral** with:
  - restriction flags (collateral is not “free” for trading),
  - valuation snapshots,
  - haircut schedules (configurable),
  - coverage ratio and shortfall alerts.
- Provide **mass rollover** processing:
  - select a date,
  - find all repos maturing on that date,
  - close them,
  - create new repo series/security,
  - open new repos with reinvested amounts,
  - optionally adjust amounts per portfolio (deposit/withdrawal).
- Provide **single rollover** processing with optional overrides (rate, maturity, counterparty, security type) and a rule: **if user enters explicit amount, it must be a single portfolio run**.
- Provide auditability and maker-checker controls (FO vs BO).

### 1.2 Non-Goals (Phase 1)
- Automated integration to LankaSecure/RTGS (optional Phase 2).
- Trade negotiation / RFQ / dealer quoting platform.
- Tri-party repo / CCP netting.
- Full accounting GL; instead produce a **blotter/ledger export** (or minimal postings table).

---

## 2. Sri Lanka Repo Market Nuances (Functional Implications)

### 2.1 Repo behaves like FD/time deposit with collateral
**Implication:** Repo is represented as a **cash placement** + **collateral movements**, not as a true buy/sell of the collateral security for performance/positions.

### 2.2 Collateral is government securities held in CBSL demat (LankaSecure)
**Implication:** Each portfolio has custody identifiers; collateral positions must be linked to **portfolio custody accounts** and tracked as **restricted holdings**.

### 2.3 Haircuts and over-collateralization are operationally required
**Implication:** System must store haircut % per collateral line and compute coverage:
- Example: lend LKR 100m, receive MV LKR 110m collateral.

### 2.4 Securities are not created by traders
**Implication:** Security master changes require **Back Office approval**.
But operationally, repos are placed daily: system must support **fast creation of new repo series** while enforcing maker-checker.

---

## 3. Users, Roles, and Permissions (RBAC)

### 3.1 Roles
- **FO_TRADER**: create repo drafts, propose rollover batches, view reporting.
- **BO_OPERATIONS**: approve securities, approve & post repo/collateral events, run/approve batch rollovers.
- **RISK_COMPLIANCE**: configure haircut schedules/limits; view exposure/shortfall reports.
- **OPS_SUPERVISOR**: manage exceptions, override within policy, finalize batches.
- **READ_ONLY**: view-only.

### 3.2 Permission rules
- FO can create **Draft** repo trades and propose new repo securities as **UNSUPERVISED**.
- BO must approve repo securities and repo trades before they are posted.
- Only BO/OPS_SUPERVISOR can mark a security as **APPROVED** or a repo trade as **POSTED**.

---

## 4. Core Concepts and Entities

### 4.1 Repo Series vs Portfolio Allocation
To support bulk operations:
- **Repo Series/Security**: the “instrument” created daily (e.g., “ABC Bank Repo 2019-01-02→2019-01-05 @ 8.5%”)
- **Repo Allocation/Position**: each portfolio’s invested amount in that repo series.

### 4.2 Collateral
Collateral is tracked per **repo allocation** (recommended for Sri Lanka demat reality), with optional ability to record a basket at the repo series level and allocate down.

### 4.3 Rollover Batch
A rollover batch represents one operational run on a rollover date, producing:
- closure of old allocations,
- creation of new repo series/security,
- creation of new allocations,
- collateral actions (reuse, replace, pending confirmation).

---

## 5. End-to-End Workflows

### 5.1 New Repo Placement (Bulk across portfolios)
**Actor:** FO_TRADER → BO_OPERATIONS  
1. FO creates a **Repo Series draft**: counterparty, issue date, maturity date (or tenor), rate, security type.
2. FO adds allocations for multiple portfolios (principal amounts).
3. FO attaches collateral basket(s) (optional at draft stage; can be confirmed by BO later).
4. FO submits for approval.
5. BO validates:
   - security master creation/approval,
   - interest math and dates,
   - collateral coverage (MV and haircut),
   - counterparty limits (if configured).
6. BO posts:
   - repo open entries (cash out / investment),
   - collateral received (restricted holdings).

### 5.2 Maturity Outcomes (Sri Lanka scenarios)
On maturity date, each allocation can:
1. **End**: receive cash, return collateral, close.
2. **Rollover with interest**: reinvest principal + interest.
3. **Rollover principal only**: withdraw interest.
4. **Rollover with partial withdrawal**: withdraw some principal and/or interest.
5. **Rollover with added capital**: add capital; interest may be reinvested or withdrawn.
6. **Rollover without interest but add capital**: principal only reinvest + deposit; interest withdrawn.

### 5.3 Mass Rollover
**Actor:** FO_TRADER proposes → BO/OPS executes  
Inputs:
- Portfolio group (or a list of portfolios)
- Rollover date
- Optional overrides: new rate, new maturity date/tenor, counterparty, new security type

System actions:
- Find all repo allocations maturing on rollover date for eligible repo security types.
- Calculate maturity proceeds per allocation.
- Apply reinvest rules and capital adjustments to compute **new invest amount**.
- Close old allocations and generate new repo series/security (grouped by parameters).
- Create new allocations for each portfolio.

### 5.4 Single Rollover
Inputs:
- Portfolio (mandatory)
- Rollover date (issue date)
- Security type + security symbol (to identify old series)
Optional:
- new rate, new maturity date, new counterparty, new security type
- amount override (only for capital deposit/withdrawal)

Rule:
- If “amount override” is entered, run must be **single portfolio only** (no portfolio group).

### 5.5 Collateral Reuse vs Replace in Rollovers
Per counterparty/policy:
- **Reuse**: carry forward collateral basket linkage to new allocation (revalue and recompute coverage).
- **Replace**: require user to enter a new collateral basket (new receive/return movements).
- **Pending**: create new repo allocation but mark collateral status pending confirmation (exception queue).

---

## 6. Functional Requirements (FR)

### FR-1 Repo Series / Security Master
- FR-1.1 Create repo security series daily (by counterparty + issue date + maturity + rate + type).
- FR-1.2 Securities have statuses: UNSUPERVISED → PENDING_BO_APPROVAL → APPROVED → INACTIVE.
- FR-1.3 Only BO can approve securities.
- FR-1.4 Security symbol generation must depend on counterparty (configurable naming).

### FR-2 Repo Allocation / Positioning
- FR-2.1 Allocate a repo series across N portfolios.
- FR-2.2 Track principal, interest parameters, and custody location/lot location per allocation.
- FR-2.3 Store maturity proceeds snapshot at maturity time (for audit).

### FR-3 Interest and Accrual
- FR-3.1 Support configurable day count conventions (ACT/365, ACT/360, 30/360).
- FR-3.2 Provide deterministic interest computation.
- FR-3.3 (Optional) Daily accrual snapshots per allocation.

### FR-4 Collateral Capture & Restriction
- FR-4.1 Collateral basket per allocation:
  - security (ISIN/internal), face value, dirty price, market value, haircut %, valuation date
- FR-4.2 Collateral must be marked restricted (not tradable like free holdings).
- FR-4.3 Allow collateral substitution events (out/in) linked to allocation.
- FR-4.4 Track external custodian references for reconciliation.

### FR-5 Collateral Valuation & Haircut Coverage
- FR-5.1 Store valuation snapshots and compute haircut-adjusted value.
- FR-5.2 Compute coverage ratio and shortfall/excess at trade entry and at least daily.
- FR-5.3 Haircut policy is configurable and can be seeded from regulatory minimum schedules (but must be editable).

### FR-6 Rollover Tool
- FR-6.1 Mass rollover based on rollover date + repo type list.
- FR-6.2 Single rollover by portfolio + repo series.
- FR-6.3 Create closing events and opening events; optionally reuse/replace collateral.
- FR-6.4 Prevent group run if amount override is supplied (single-run constraint).

### FR-7 Bulk Upload (CSV/XLSX)
- FR-7.1 Upload allocations and rollover adjustments (deposit/withdrawal).
- FR-7.2 Validate and return row-level errors.

### FR-8 Reporting
- FR-8.1 Counterparty exposure report (investments + collateral aggregated by counterparty).
- FR-8.2 Maturity ladder report by date bucket.
- FR-8.3 Collateral shortfall/excess report (exceptions queue).
- FR-8.4 Rollover batch report (what closed/opened and cash deltas).

### FR-9 Audit & Approvals
- FR-9.1 Maker-checker with audit trail for:
  - security master approvals,
  - repo postings,
  - rollover batch run/finalize,
  - haircut overrides.
- FR-9.2 Every status change is logged.

---

## 7. Business Rules (BR)

### BR-1 Identify repos eligible for rollover
Eligible if:
- allocation.repo_series.maturity_date == rollover_date
- repo_series.security_type is in configured list (`repo_security_types`)
- allocation.status == ACTIVE/POSTED

### BR-2 Tenor calculation
`tenor_days = maturity_date - issue_date` (date difference in days)

### BR-3 Interest calculation (deterministic)
Let:
- `principal` (numeric)
- `rate` (annual, decimal, e.g., 0.085)
- `accrual_days` (integer)
- `day_count_basis` in {365, 360, 30/360 method}

Then:
`interest = principal * rate * (accrual_days / basis)`

**Configuration must define:**
- whether maturity date is inclusive
- holiday/weekend adjustment rules

### BR-4 Maturity proceeds
`maturity_proceeds = principal + interest`

### BR-5 New investment amount on rollover (covers all Sri Lanka scenarios)
Inputs per allocation:
- `reinvest_interest` (boolean, default true)
- `capital_adjustment` (numeric; +deposit, -withdrawal; default 0)

Compute:
- `interest_reinvested = interest if reinvest_interest else 0`
- `new_invest_amount = principal + interest_reinvested + capital_adjustment`

Validation:
- `new_invest_amount >= 0`
- if `new_invest_amount == 0`, treat as “End” unless explicitly allowed.

### BR-6 Counterparty change on rollover
Default is old counterparty.
If changed:
- do not automatically reuse collateral; require replace/pending.

### BR-7 Security type change
If new tenor differs materially (config), system should allow new security type (e.g., short-term vs long-term repo types).

### BR-8 Collateral haircut-adjusted value
For each collateral line:
- `haircut_value = market_value * (1 - haircut_pct)`
Total:
- `total_haircut_value = sum(haircut_value)`

### BR-9 Coverage requirement
Define required coverage as:
- `required_collateral_mv = maturity_proceeds * (1 + required_buffer_pct)`  
  (buffer_pct can be derived from policy/haircut schedule)

or alternatively:
- compare `total_haircut_value >= maturity_proceeds`

**Implementation must support both methods as config** (because institutions differ).

### BR-10 Collateral restriction
Collateral is stored separately from free holdings and cannot be sold/traded unless explicitly permitted by policy and user role.

### BR-11 Amount override constraint (single rollover)
If user provides an explicit “amount override” value in the rollover run, portfolio input must be a single portfolio; otherwise hard fail.

---

## 8. Data Model (Supabase/Postgres)

### 8.1 Multi-tenancy strategy
- Every business table includes `org_id`.
- Users belong to org(s) via `org_members`.
- Row Level Security (RLS) enforces org boundaries.

### 8.2 Table list (high-level)
- `orgs`
- `org_members`
- `profiles` (optional; maps auth.users to display name)
- `portfolio_groups`, `portfolio_group_members` (optional)
- `portfolios`
- `cash_accounts`
- `custody_accounts`
- `counterparties`
- `security_types`
- `securities` (includes government securities and repo series)
- `repo_trades` (header for a repo series placement)
- `repo_allocations` (portfolio-level position)
- `repo_accruals` (optional daily accrual snapshots)
- `collateral_positions`
- `collateral_valuations` (optional)
- `rollover_batches`
- `rollover_batch_items`
- `ledger_entries` (optional but recommended)
- `audit_log`
- `config_settings` (org-level settings incl repo_security_types)

---

## 9. Supabase SQL Schema (MVP Migration)

> Copy into Supabase SQL Editor as a migration. Adjust naming to your conventions.

```sql
-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ================
-- Enums
-- ================
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
  create type public.batch_status as enum ('DRAFT','SUBMITTED','RUNNING','COMPLETED','FAILED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.batch_item_status as enum ('PENDING','SUCCESS','FAILED','SKIPPED');
exception when duplicate_object then null; end $$;

-- ================
-- Core org tables
-- ================
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

-- ================
-- Reference data
-- ================
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
  day_count_basis int, -- 360/365; or null if not applicable
  status public.security_status not null default 'UNSUPERVISED',
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, symbol)
);

-- ================
-- Portfolios and accounts
-- ================
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

-- ================
-- Repo header and allocations
-- ================
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
  lot_location text, -- optional "lot location" compatibility
  principal numeric(20,2) not null,
  reinvest_interest boolean not null default true,
  capital_adjustment numeric(20,2) not null default 0,
  status public.repo_status not null default 'ACTIVE',
  maturity_interest numeric(20,2), -- snapshot at maturity
  maturity_proceeds numeric(20,2), -- snapshot at maturity
  created_at timestamptz not null default now()
);

-- Optional daily accrual snapshots (can be computed on the fly in MVP)
create table if not exists public.repo_accruals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo_allocation_id uuid not null references public.repo_allocations(id) on delete cascade,
  accrual_date date not null,
  accrued_interest numeric(20,2) not null,
  created_at timestamptz not null default now(),
  unique (org_id, repo_allocation_id, accrual_date)
);

-- ================
-- Collateral positions (restricted)
-- ================
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

-- ================
-- Rollover batches
-- ================
create table if not exists public.rollover_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  mode public.rollover_mode not null,
  rollover_date date not null,
  portfolio_selector text, -- e.g. group code or json list id
  params jsonb not null default '{}'::jsonb, -- rate/maturity overrides, etc.
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

  -- Computed at run time
  principal numeric(20,2) not null,
  interest numeric(20,2) not null,
  maturity_proceeds numeric(20,2) not null,
  reinvest_interest boolean not null default true,
  capital_adjustment numeric(20,2) not null default 0,
  new_invest_amount numeric(20,2) not null,

  -- Overrides / changes
  new_rate numeric(12,8),
  new_maturity_date date,
  new_counterparty_id uuid references public.counterparties(id),
  new_security_type_id uuid references public.security_types(id),
  collateral_mode text not null default 'REUSE', -- REUSE|REPLACE|PENDING

  -- Outputs
  new_repo_trade_id uuid references public.repo_trades(id),
  new_repo_allocation_id uuid references public.repo_allocations(id),

  status public.batch_item_status not null default 'PENDING',
  error_message text,
  created_at timestamptz not null default now()
);

-- ================
-- Minimal audit log
-- ================
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

-- ================
-- Org settings
-- ================
create table if not exists public.config_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  repo_security_type_codes text not null default 'srlk,lrlk',
  default_day_count_basis int not null default 365,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_repo_trades_org_maturity on public.repo_trades(org_id, maturity_date);
create index if not exists idx_repo_allocations_org_portfolio on public.repo_allocations(org_id, portfolio_id);
create index if not exists idx_collateral_positions_org_portfolio on public.collateral_positions(org_id, portfolio_id);
create index if not exists idx_rollover_items_batch on public.rollover_batch_items(batch_id);

```

---

## 10. Supabase Row Level Security (RLS)

### 10.1 Helper function
```sql
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
```

### 10.2 Enable RLS + base policies
Apply this pattern to each table with `org_id`:

```sql
alter table public.portfolios enable row level security;

create policy "org_members_select_portfolios"
on public.portfolios for select
using (public.is_org_member(org_id));

create policy "org_members_modify_portfolios"
on public.portfolios for insert
with check (public.is_org_member(org_id));

create policy "org_members_update_portfolios"
on public.portfolios for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));
```

### 10.3 Role-based restrictions (security approvals example)
**Rule:** Only BO/OPS can approve securities.

Option A (simple): enforce at application layer (recommended early).
Option B (strong): enforce using a SQL policy + trigger:

```sql
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
```

---

## 11. Key Stored Procedures / RPC (Recommended)

### 11.1 Compute interest (pure function)
```sql
create or replace function public.fn_compute_interest(
  p_principal numeric,
  p_rate numeric,
  p_issue date,
  p_maturity date,
  p_basis int
) returns numeric
language plpgsql immutable as $$
declare
  d int;
begin
  d := (p_maturity - p_issue);
  return round(p_principal * p_rate * (d::numeric / p_basis::numeric), 2);
end;
$$;
```

### 11.2 Rollover batch runner (skeleton)
Implementation approach:
- Create batch items first (preview).
- Run batch: for each item
  - compute interest + proceeds
  - compute new amount using BR-5
  - close old allocation (status → MATURED/CLOSED)
  - create or reuse a new repo security (grouping)
  - create new repo_trade + new allocation
  - create collateral actions based on collateral_mode
  - mark item SUCCESS/FAILED

> You can implement as SQL function or in an Edge Function for easier orchestration.

---

## 12. UI Requirements (Screens)

### 12.1 Repo Entry (Series + Allocations)
- Header: counterparty, issue date, maturity date/tenor, rate, security type
- Allocations grid: portfolio, principal, reinvest_interest, capital_adjustment
- Collateral tab: add collateral lines per portfolio allocation (or per allocation group)
- Submit for approval

### 12.2 Collateral Monitor
- Filters: date, counterparty, portfolio
- Show: collateral MV, haircut-adjusted MV, repo proceeds coverage, shortfalls
- Actions: add collateral, substitute, mark as returned

### 12.3 Rollover Wizard
- Select rollover date
- Mode: MASS / SINGLE / UPLOAD
- MASS:
  - select portfolio group or portfolios
  - override new rate/maturity/security type/counterparty (optional)
  - choose default collateral handling (reuse/replace/pending)
  - preview list of maturing allocations with computed proceeds and new amounts
- SINGLE:
  - choose portfolio + old repo security
  - apply overrides
  - enforce amount override constraint

### 12.4 Exceptions Queue
- Missing collateral or pending collateral confirmation
- Collateral shortfalls
- Missing prices/valuations
- Batch item failures

---

## 13. Reporting Requirements (Outputs)

### 13.1 Counterparty Exposure (Primary)
Group by counterparty:
- total principal outstanding
- accrued interest (or estimated)
- maturity ladder (buckets configurable)
- collateral MV total
- haircut-adjusted collateral total
- coverage ratio and exceptions

### 13.2 Maturity Calendar
- list repos maturing by date and portfolio
- exportable to CSV

### 13.3 Rollover Batch Report
- closed allocations
- new repo series created
- new allocations created
- cash delta summary:
  - interest withdrawn
  - net deposits/withdrawals
- exceptions

---

## 14. Acceptance Tests (AT)

### AT-1 Day 1 bulk placement
Given 6 portfolios invest different amounts into the same repo series
When BO posts the repo
Then 6 allocations exist linked to one repo security and one repo_trade

### AT-2 Day 2 mass rollover with new rate/maturity
Given those allocations mature on Day 2
When mass rollover runs with new rate and new maturity date
Then old allocations are closed and new allocations created
And new repo security series exists for the new terms

### AT-3 Day 3 rollover with deposit/withdrawal
Given allocations mature Day 3
When client B adds capital and client D withdraws principal
Then new allocation amounts reflect maturity proceeds + adjustment
And negative resulting amounts are rejected

### AT-4 Single rollover amount override constraint
When user enters an explicit amount override and selects a portfolio group
Then the process fails with a clear validation error

### AT-5 Collateral restriction
Given collateral holdings recorded
When user tries to trade/sell collateral in normal holdings UI
Then system blocks unless role/policy allows

---

## 15. Implementation Checklist (Cursor-friendly)

- [ ] Create Supabase schema and RLS policies
- [ ] Build repo security creation workflow + approval
- [ ] Build repo trade + allocation capture (bulk)
- [ ] Implement interest calculation and maturity proceeds
- [ ] Implement collateral capture, valuation snapshots, coverage math
- [ ] Implement rollover batch:
  - preview
  - run
  - audit and idempotency safeguards
- [ ] Build reporting views + exports
- [ ] Add exception queue and notifications
- [ ] Add comprehensive audit logging

---

## 16. Glossary
- **Repo**: cash placement secured by collateral, with agreed repurchase/maturity terms.
- **Repo series/security**: daily instrument created for repo placements (per counterparty/terms).
- **Allocation**: a portfolio’s invested amount into a repo series.
- **Collateral**: government securities delivered into portfolio demat as security for the cash placement.
- **Haircut**: discount/buffer applied to collateral market value for coverage.
- **LankaSecure**: CBSL system for scripless government securities depository/settlement.
