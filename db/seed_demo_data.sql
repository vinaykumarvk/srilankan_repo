-- ==============================================
-- SEED SCRIPT FOR SRI LANKA REPO OPS
-- Run this in Supabase SQL Editor
-- ==============================================

-- Step 1: Create demo user (bypassing email confirmation)
-- This creates the user directly in auth.users
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

-- Step 2: Create organization
INSERT INTO public.orgs (id, name) 
VALUES ('11111111-1111-1111-1111-111111111111', 'Demo Asset Management')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Step 3: Link user to organization
INSERT INTO public.org_members (org_id, user_id, role)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'dddd1111-1111-1111-1111-111111111111',
  'FO_TRADER'
) ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- Step 4: Create config settings
INSERT INTO public.config_settings (
  org_id,
  repo_security_type_codes,
  default_day_count_basis,
  day_count_method,
  include_maturity,
  use_holiday_calendar,
  holiday_roll
)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'srlk,lrlk',
  365,
  'ACT/365',
  false,
  false,
  'FOLLOWING'
)
ON CONFLICT (org_id) DO UPDATE SET 
  repo_security_type_codes = EXCLUDED.repo_security_type_codes,
  default_day_count_basis = EXCLUDED.default_day_count_basis,
  day_count_method = EXCLUDED.day_count_method,
  include_maturity = EXCLUDED.include_maturity,
  use_holiday_calendar = EXCLUDED.use_holiday_calendar,
  holiday_roll = EXCLUDED.holiday_roll;

-- Step 5: Create counterparties
INSERT INTO public.counterparties (org_id, name, short_code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Bank of Ceylon', 'BOC'),
  ('11111111-1111-1111-1111-111111111111', 'People''s Bank', 'PB'),
  ('11111111-1111-1111-1111-111111111111', 'Commercial Bank', 'COMB'),
  ('11111111-1111-1111-1111-111111111111', 'Hatton National Bank', 'HNB'),
  ('11111111-1111-1111-1111-111111111111', 'Sampath Bank', 'SAMP')
ON CONFLICT (org_id, short_code) DO UPDATE SET name = EXCLUDED.name;

-- Step 6: Create security types
INSERT INTO public.security_types (org_id, code, name, is_repo_type) VALUES
  ('11111111-1111-1111-1111-111111111111', 'srlk', 'Short-term Repo (LKR)', true),
  ('11111111-1111-1111-1111-111111111111', 'lrlk', 'Long-term Repo (LKR)', true),
  ('11111111-1111-1111-1111-111111111111', 'tbill', 'Treasury Bill', false),
  ('11111111-1111-1111-1111-111111111111', 'tbond', 'Treasury Bond', false)
ON CONFLICT (org_id, code) DO UPDATE SET 
  name = EXCLUDED.name,
  is_repo_type = EXCLUDED.is_repo_type;

-- Step 7: Create portfolios
INSERT INTO public.portfolios (id, org_id, code, name) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'PF-001', 'Growth Fund Alpha'),
  ('aaaa2222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'PF-002', 'Income Fund Beta'),
  ('aaaa3333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'PF-003', 'Balanced Fund Gamma'),
  ('aaaa4444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'PF-004', 'Money Market Fund')
ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name;

-- Step 7b: Create portfolio group
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

-- Step 8: Create cash accounts
INSERT INTO public.cash_accounts (org_id, portfolio_id, bank_name, account_no, currency) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 'Bank of Ceylon', 'BOC-001-LKR', 'LKR'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa2222-2222-2222-2222-222222222222', 'Bank of Ceylon', 'BOC-002-LKR', 'LKR'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa3333-3333-3333-3333-333333333333', 'Commercial Bank', 'COMB-003-LKR', 'LKR'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa4444-4444-4444-4444-444444444444', 'People''s Bank', 'PB-004-LKR', 'LKR')
ON CONFLICT DO NOTHING;

-- Step 9: Create custody accounts
INSERT INTO public.custody_accounts (org_id, portfolio_id, provider, account_no) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 'CBSL_LankaSecure', 'LS-001'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa2222-2222-2222-2222-222222222222', 'CBSL_LankaSecure', 'LS-002'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa3333-3333-3333-3333-333333333333', 'CBSL_LankaSecure', 'LS-003'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa4444-4444-4444-4444-444444444444', 'CBSL_LankaSecure', 'LS-004')
ON CONFLICT DO NOTHING;

-- ==============================================
-- DONE! 
-- ==============================================
-- 
-- Login credentials:
--   Email: demo@repo.local
--   Password: Demo123!
--
-- ==============================================


