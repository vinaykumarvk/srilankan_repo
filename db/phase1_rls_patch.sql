-- Patch: add missing RLS policies for org-scoped tables.

-- Counterparties
drop policy if exists counterparties_select on public.counterparties;
create policy counterparties_select
on public.counterparties for select
using (public.is_org_member(org_id));

drop policy if exists counterparties_insert on public.counterparties;
create policy counterparties_insert
on public.counterparties for insert
with check (public.is_org_member(org_id));

drop policy if exists counterparties_update on public.counterparties;
create policy counterparties_update
on public.counterparties for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Security types
drop policy if exists security_types_select on public.security_types;
create policy security_types_select
on public.security_types for select
using (public.is_org_member(org_id));

drop policy if exists security_types_insert on public.security_types;
create policy security_types_insert
on public.security_types for insert
with check (public.is_org_member(org_id));

drop policy if exists security_types_update on public.security_types;
create policy security_types_update
on public.security_types for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Securities
drop policy if exists securities_select on public.securities;
create policy securities_select
on public.securities for select
using (public.is_org_member(org_id));

drop policy if exists securities_insert on public.securities;
create policy securities_insert
on public.securities for insert
with check (public.is_org_member(org_id));

drop policy if exists securities_update on public.securities;
create policy securities_update
on public.securities for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Portfolios
drop policy if exists portfolios_select on public.portfolios;
create policy portfolios_select
on public.portfolios for select
using (public.is_org_member(org_id));

drop policy if exists portfolios_insert on public.portfolios;
create policy portfolios_insert
on public.portfolios for insert
with check (public.is_org_member(org_id));

drop policy if exists portfolios_update on public.portfolios;
create policy portfolios_update
on public.portfolios for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Portfolio groups
drop policy if exists portfolio_groups_select on public.portfolio_groups;
create policy portfolio_groups_select
on public.portfolio_groups for select
using (public.is_org_member(org_id));

drop policy if exists portfolio_groups_insert on public.portfolio_groups;
create policy portfolio_groups_insert
on public.portfolio_groups for insert
with check (public.is_org_member(org_id));

drop policy if exists portfolio_groups_update on public.portfolio_groups;
create policy portfolio_groups_update
on public.portfolio_groups for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

drop policy if exists portfolio_group_members_select on public.portfolio_group_members;
create policy portfolio_group_members_select
on public.portfolio_group_members for select
using (public.is_org_member(org_id));

drop policy if exists portfolio_group_members_insert on public.portfolio_group_members;
create policy portfolio_group_members_insert
on public.portfolio_group_members for insert
with check (public.is_org_member(org_id));

drop policy if exists portfolio_group_members_update on public.portfolio_group_members;
create policy portfolio_group_members_update
on public.portfolio_group_members for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Cash accounts
drop policy if exists cash_accounts_select on public.cash_accounts;
create policy cash_accounts_select
on public.cash_accounts for select
using (public.is_org_member(org_id));

drop policy if exists cash_accounts_insert on public.cash_accounts;
create policy cash_accounts_insert
on public.cash_accounts for insert
with check (public.is_org_member(org_id));

drop policy if exists cash_accounts_update on public.cash_accounts;
create policy cash_accounts_update
on public.cash_accounts for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Custody accounts
drop policy if exists custody_accounts_select on public.custody_accounts;
create policy custody_accounts_select
on public.custody_accounts for select
using (public.is_org_member(org_id));

drop policy if exists custody_accounts_insert on public.custody_accounts;
create policy custody_accounts_insert
on public.custody_accounts for insert
with check (public.is_org_member(org_id));

drop policy if exists custody_accounts_update on public.custody_accounts;
create policy custody_accounts_update
on public.custody_accounts for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Repo trades
drop policy if exists repo_trades_select on public.repo_trades;
create policy repo_trades_select
on public.repo_trades for select
using (public.is_org_member(org_id));

drop policy if exists repo_trades_insert on public.repo_trades;
create policy repo_trades_insert
on public.repo_trades for insert
with check (public.is_org_member(org_id));

drop policy if exists repo_trades_update on public.repo_trades;
create policy repo_trades_update
on public.repo_trades for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Repo allocations
drop policy if exists repo_allocations_select on public.repo_allocations;
create policy repo_allocations_select
on public.repo_allocations for select
using (public.is_org_member(org_id));

drop policy if exists repo_allocations_insert on public.repo_allocations;
create policy repo_allocations_insert
on public.repo_allocations for insert
with check (public.is_org_member(org_id));

drop policy if exists repo_allocations_update on public.repo_allocations;
create policy repo_allocations_update
on public.repo_allocations for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Repo accruals
drop policy if exists repo_accruals_select on public.repo_accruals;
create policy repo_accruals_select
on public.repo_accruals for select
using (public.is_org_member(org_id));

drop policy if exists repo_accruals_insert on public.repo_accruals;
create policy repo_accruals_insert
on public.repo_accruals for insert
with check (public.is_org_member(org_id));

drop policy if exists repo_accruals_update on public.repo_accruals;
create policy repo_accruals_update
on public.repo_accruals for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Collateral positions
drop policy if exists collateral_positions_select on public.collateral_positions;
create policy collateral_positions_select
on public.collateral_positions for select
using (public.is_org_member(org_id));

drop policy if exists collateral_positions_insert on public.collateral_positions;
create policy collateral_positions_insert
on public.collateral_positions for insert
with check (public.is_org_member(org_id));

drop policy if exists collateral_positions_update on public.collateral_positions;
create policy collateral_positions_update
on public.collateral_positions for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Collateral substitutions
drop policy if exists collateral_substitutions_select on public.collateral_substitutions;
create policy collateral_substitutions_select
on public.collateral_substitutions for select
using (public.is_org_member(org_id));

drop policy if exists collateral_substitutions_insert on public.collateral_substitutions;
create policy collateral_substitutions_insert
on public.collateral_substitutions for insert
with check (public.is_org_member(org_id));

drop policy if exists collateral_substitutions_update on public.collateral_substitutions;
create policy collateral_substitutions_update
on public.collateral_substitutions for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Rollover batches
drop policy if exists rollover_batches_select on public.rollover_batches;
create policy rollover_batches_select
on public.rollover_batches for select
using (public.is_org_member(org_id));

drop policy if exists rollover_batches_insert on public.rollover_batches;
create policy rollover_batches_insert
on public.rollover_batches for insert
with check (public.is_org_member(org_id));

drop policy if exists rollover_batches_update on public.rollover_batches;
create policy rollover_batches_update
on public.rollover_batches for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Rollover batch items
drop policy if exists rollover_batch_items_select on public.rollover_batch_items;
create policy rollover_batch_items_select
on public.rollover_batch_items for select
using (public.is_org_member(org_id));

drop policy if exists rollover_batch_items_insert on public.rollover_batch_items;
create policy rollover_batch_items_insert
on public.rollover_batch_items for insert
with check (public.is_org_member(org_id));

drop policy if exists rollover_batch_items_update on public.rollover_batch_items;
create policy rollover_batch_items_update
on public.rollover_batch_items for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Audit log
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select
on public.audit_log for select
using (public.is_org_member(org_id));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert
on public.audit_log for insert
with check (public.is_org_member(org_id));

-- Config settings
drop policy if exists config_settings_select on public.config_settings;
create policy config_settings_select
on public.config_settings for select
using (public.is_org_member(org_id));

drop policy if exists config_settings_insert on public.config_settings;
create policy config_settings_insert
on public.config_settings for insert
with check (public.is_org_member(org_id));

drop policy if exists config_settings_update on public.config_settings;
create policy config_settings_update
on public.config_settings for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Org holidays
drop policy if exists org_holidays_select on public.org_holidays;
create policy org_holidays_select
on public.org_holidays for select
using (public.is_org_member(org_id));

drop policy if exists org_holidays_insert on public.org_holidays;
create policy org_holidays_insert
on public.org_holidays for insert
with check (public.is_org_member(org_id));

drop policy if exists org_holidays_update on public.org_holidays;
create policy org_holidays_update
on public.org_holidays for update
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));
