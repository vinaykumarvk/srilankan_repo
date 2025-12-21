-- Fix ambiguous column reference in compute_repo_interest_config function
-- Run this in Supabase SQL Editor

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

