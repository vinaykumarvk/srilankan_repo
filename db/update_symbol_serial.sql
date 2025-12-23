-- Update build_repo_symbol to include a running serial number for uniqueness
-- Run this in Supabase SQL Editor

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
  base_symbol text;
  serial_num int;
begin
  select short_code into cp_code
  from public.counterparties
  where id = p_counterparty_id;

  if cp_code is null then
    cp_code := 'REPO';
  end if;

  rate_pct := trim(to_char(p_rate * 100, 'FM9990.00'));

  -- Build the base symbol without serial number
  base_symbol := concat_ws(
    '-',
    cp_code,
    to_char(p_issue_date, 'YYYYMMDD'),
    to_char(p_maturity_date, 'YYYYMMDD'),
    rate_pct
  );

  -- Count existing securities with this base symbol pattern and add 1
  select count(*) + 1 into serial_num
  from public.securities
  where symbol like base_symbol || '-%'
     or symbol = base_symbol;

  -- Return symbol with serial number (padded to 3 digits)
  return base_symbol || '-' || lpad(serial_num::text, 3, '0');
end;
$$;

-- Grant execute permission
grant execute on function public.build_repo_symbol(uuid, date, date, numeric) to authenticated;

