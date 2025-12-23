-- =============================================
-- Seed Data for Maturity Processing Demo
-- 10 APPROVED repos: 5 today, 3 tomorrow, 2 day after
-- Each with multiple clients and sufficient collateral
-- =============================================

-- Get the org_id (assuming single org setup)
DO $$
DECLARE
  v_org_id uuid := '11111111-1111-1111-1111-111111111111';
  v_user_id uuid;
  
  -- Counterparty IDs (will be fetched)
  v_cp_boc uuid;
  v_cp_pb uuid;
  v_cp_hnb uuid;
  v_cp_sampath uuid;
  v_cp_comm uuid;
  
  -- Portfolio IDs (will be fetched)
  v_pf_growth uuid;
  v_pf_income uuid;
  v_pf_balanced uuid;
  v_pf_pension uuid;
  
  -- Security type for repos
  v_repo_type_id uuid;
  
  -- Bond security IDs for collateral
  v_bond_1 uuid;
  v_bond_2 uuid;
  v_bond_3 uuid;
  v_bond_4 uuid;
  v_bond_5 uuid;
  
  -- Dates
  v_today date := CURRENT_DATE;
  v_tomorrow date := CURRENT_DATE + 1;
  v_day_after date := CURRENT_DATE + 2;
  
  -- Trade and allocation IDs
  v_trade_id uuid;
  v_alloc_id uuid;
  v_sec_id uuid;
  
BEGIN
  -- Get a user ID for created_by (use first available)
  SELECT user_id INTO v_user_id FROM org_members WHERE org_id = v_org_id LIMIT 1;
  
  -- Get counterparty IDs
  SELECT id INTO v_cp_boc FROM counterparties WHERE org_id = v_org_id AND short_code = 'BOC' LIMIT 1;
  SELECT id INTO v_cp_pb FROM counterparties WHERE org_id = v_org_id AND short_code = 'PB' LIMIT 1;
  SELECT id INTO v_cp_hnb FROM counterparties WHERE org_id = v_org_id AND short_code = 'HNB' LIMIT 1;
  SELECT id INTO v_cp_sampath FROM counterparties WHERE org_id = v_org_id AND short_code = 'SAMP' LIMIT 1;
  SELECT id INTO v_cp_comm FROM counterparties WHERE org_id = v_org_id AND short_code = 'COMB' LIMIT 1;
  
  -- Fallback if some counterparties don't exist
  IF v_cp_boc IS NULL THEN SELECT id INTO v_cp_boc FROM counterparties WHERE org_id = v_org_id LIMIT 1; END IF;
  IF v_cp_pb IS NULL THEN v_cp_pb := v_cp_boc; END IF;
  IF v_cp_hnb IS NULL THEN v_cp_hnb := v_cp_boc; END IF;
  IF v_cp_sampath IS NULL THEN v_cp_sampath := v_cp_boc; END IF;
  IF v_cp_comm IS NULL THEN v_cp_comm := v_cp_boc; END IF;
  
  -- Get portfolio IDs (use actual codes from step3_user_and_data.sql: PF-001, PF-002, PF-003, PF-004)
  SELECT id INTO v_pf_growth FROM portfolios WHERE org_id = v_org_id AND code = 'PF-001' LIMIT 1;
  SELECT id INTO v_pf_income FROM portfolios WHERE org_id = v_org_id AND code = 'PF-002' LIMIT 1;
  SELECT id INTO v_pf_balanced FROM portfolios WHERE org_id = v_org_id AND code = 'PF-003' LIMIT 1;
  SELECT id INTO v_pf_pension FROM portfolios WHERE org_id = v_org_id AND code = 'PF-004' LIMIT 1;
  
  -- Fallback if some portfolios don't exist - try to get distinct portfolios
  IF v_pf_growth IS NULL THEN SELECT id INTO v_pf_growth FROM portfolios WHERE org_id = v_org_id ORDER BY code LIMIT 1; END IF;
  IF v_pf_income IS NULL THEN SELECT id INTO v_pf_income FROM portfolios WHERE org_id = v_org_id AND id != v_pf_growth ORDER BY code LIMIT 1; END IF;
  IF v_pf_balanced IS NULL THEN SELECT id INTO v_pf_balanced FROM portfolios WHERE org_id = v_org_id AND id NOT IN (v_pf_growth, v_pf_income) ORDER BY code LIMIT 1; END IF;
  IF v_pf_pension IS NULL THEN SELECT id INTO v_pf_pension FROM portfolios WHERE org_id = v_org_id AND id NOT IN (v_pf_growth, v_pf_income, v_pf_balanced) ORDER BY code LIMIT 1; END IF;
  
  -- Final fallback if less than 4 portfolios exist
  IF v_pf_income IS NULL THEN v_pf_income := v_pf_growth; END IF;
  IF v_pf_balanced IS NULL THEN v_pf_balanced := v_pf_growth; END IF;
  IF v_pf_pension IS NULL THEN v_pf_pension := v_pf_growth; END IF;
  
  -- Get repo security type
  SELECT id INTO v_repo_type_id FROM security_types WHERE org_id = v_org_id AND is_repo_type = true LIMIT 1;
  
  -- Get or create bond securities for collateral
  SELECT id INTO v_bond_1 FROM securities WHERE org_id = v_org_id AND symbol LIKE 'TB%' LIMIT 1;
  SELECT id INTO v_bond_2 FROM securities WHERE org_id = v_org_id AND symbol LIKE 'TB%' OFFSET 1 LIMIT 1;
  SELECT id INTO v_bond_3 FROM securities WHERE org_id = v_org_id AND symbol LIKE 'TB%' OFFSET 2 LIMIT 1;
  SELECT id INTO v_bond_4 FROM securities WHERE org_id = v_org_id AND symbol LIKE 'TBILL%' LIMIT 1;
  SELECT id INTO v_bond_5 FROM securities WHERE org_id = v_org_id AND symbol LIKE 'TBILL%' OFFSET 1 LIMIT 1;
  
  -- Fallback: use any non-repo securities
  IF v_bond_1 IS NULL THEN
    SELECT s.id INTO v_bond_1 FROM securities s 
    JOIN security_types st ON s.security_type_id = st.id 
    WHERE s.org_id = v_org_id AND st.is_repo_type = false LIMIT 1;
  END IF;
  IF v_bond_2 IS NULL THEN v_bond_2 := v_bond_1; END IF;
  IF v_bond_3 IS NULL THEN v_bond_3 := v_bond_1; END IF;
  IF v_bond_4 IS NULL THEN v_bond_4 := v_bond_1; END IF;
  IF v_bond_5 IS NULL THEN v_bond_5 := v_bond_1; END IF;

  RAISE NOTICE 'Using counterparties: BOC=%, PB=%, HNB=%', v_cp_boc, v_cp_pb, v_cp_hnb;
  RAISE NOTICE 'Using portfolios: GROWTH=%, INCOME=%, BALANCED=%', v_pf_growth, v_pf_income, v_pf_balanced;
  RAISE NOTICE 'Using bonds for collateral: %', v_bond_1;

  -- =============================================
  -- TRADE 1: Maturing TODAY - BOC - 50M - 3 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'BOC-MAT-TODAY-1', 'BOC Repo Maturing Today #1', v_cp_boc, v_today - 14, v_today, 0.1150, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_boc, v_today - 14, v_today, 0.1150, 365, 'APPROVED', v_user_id);
  
  -- Client 1: Growth Fund - 20M
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 20000000, 'ACTIVE');
  
  -- Collateral for Growth Fund: NCMV must exceed maturity (20M + ~88K interest = ~20.09M)
  -- Using dirty_price=102, nominals=25M, haircut=0.95 -> NCMV ≈ 24M
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_1, 25000000, 102.50, 25625000, 0.95, v_today, 'RECEIVED', 'clean_price:101.50');
  
  -- Client 2: Income Fund - 18M
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_income, 18000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_income, v_bond_2, 22000000, 103.00, 22660000, 0.95, v_today, 'RECEIVED', 'clean_price:102.00');
  
  -- Client 3: Balanced Fund - 12M
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_balanced, 12000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_balanced, v_bond_3, 15000000, 101.50, 15225000, 0.95, v_today, 'RECEIVED', 'clean_price:100.50');

  -- =============================================
  -- TRADE 2: Maturing TODAY - People's Bank - 75M - 2 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'PB-MAT-TODAY-1', 'PB Repo Maturing Today #1', v_cp_pb, v_today - 7, v_today, 0.1200, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_pb, v_today - 7, v_today, 0.1200, 365, 'APPROVED', v_user_id);
  
  -- Client 1: Growth Fund - 45M
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 45000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_1, 55000000, 102.00, 56100000, 0.95, v_today, 'RECEIVED', 'clean_price:101.00');
  
  -- Client 2: Pension Fund - 30M
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_pension, 30000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_pension, v_bond_4, 38000000, 99.50, 37810000, 0.95, v_today, 'RECEIVED', 'clean_price:98.50');

  -- =============================================
  -- TRADE 3: Maturing TODAY - HNB - 30M - 2 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'HNB-MAT-TODAY-1', 'HNB Repo Maturing Today', v_cp_hnb, v_today - 21, v_today, 0.1100, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_hnb, v_today - 21, v_today, 0.1100, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_income, 18000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_income, v_bond_2, 22000000, 102.50, 22550000, 0.95, v_today, 'RECEIVED', 'clean_price:101.50');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_balanced, 12000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_balanced, v_bond_3, 15000000, 101.00, 15150000, 0.95, v_today, 'RECEIVED', 'clean_price:100.00');

  -- =============================================
  -- TRADE 4: Maturing TODAY - Sampath - 100M - 4 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'SAMP-MAT-TODAY-1', 'Sampath Repo Maturing Today', v_cp_sampath, v_today - 30, v_today, 0.1175, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_sampath, v_today - 30, v_today, 0.1175, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 35000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_1, 42000000, 103.00, 43260000, 0.95, v_today, 'RECEIVED', 'clean_price:102.00');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_income, 25000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_income, v_bond_2, 30000000, 102.00, 30600000, 0.95, v_today, 'RECEIVED', 'clean_price:101.00');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_balanced, 25000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_balanced, v_bond_3, 30000000, 101.50, 30450000, 0.95, v_today, 'RECEIVED', 'clean_price:100.50');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_pension, 15000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_pension, v_bond_4, 18000000, 99.75, 17955000, 0.95, v_today, 'RECEIVED', 'clean_price:98.75');

  -- =============================================
  -- TRADE 5: Maturing TODAY - Commercial Bank - 40M - 2 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'COMB-MAT-TODAY-1', 'Commercial Bank Repo Today', v_cp_comm, v_today - 10, v_today, 0.1125, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_comm, v_today - 10, v_today, 0.1125, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 25000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_5, 30000000, 99.25, 29775000, 0.95, v_today, 'RECEIVED', 'clean_price:98.25');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_income, 15000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_income, v_bond_1, 18000000, 102.50, 18450000, 0.95, v_today, 'RECEIVED', 'clean_price:101.50');

  -- =============================================
  -- TRADE 6: Maturing TOMORROW - BOC - 60M - 3 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'BOC-MAT-TMR-1', 'BOC Repo Maturing Tomorrow', v_cp_boc, v_tomorrow - 14, v_tomorrow, 0.1175, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_boc, v_tomorrow - 14, v_tomorrow, 0.1175, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 30000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_2, 36000000, 102.50, 36900000, 0.95, v_today, 'RECEIVED', 'clean_price:101.50');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_income, 20000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_income, v_bond_3, 24000000, 101.75, 24420000, 0.95, v_today, 'RECEIVED', 'clean_price:100.75');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_pension, 10000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_pension, v_bond_4, 12000000, 99.50, 11940000, 0.95, v_today, 'RECEIVED', 'clean_price:98.50');

  -- =============================================
  -- TRADE 7: Maturing TOMORROW - People's Bank - 45M - 2 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'PB-MAT-TMR-1', 'PB Repo Maturing Tomorrow', v_cp_pb, v_tomorrow - 7, v_tomorrow, 0.1150, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_pb, v_tomorrow - 7, v_tomorrow, 0.1150, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_balanced, 28000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_balanced, v_bond_1, 34000000, 103.00, 35020000, 0.95, v_today, 'RECEIVED', 'clean_price:102.00');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_pension, 17000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_pension, v_bond_5, 20000000, 99.00, 19800000, 0.95, v_today, 'RECEIVED', 'clean_price:98.00');

  -- =============================================
  -- TRADE 8: Maturing TOMORROW - HNB - 55M - 3 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'HNB-MAT-TMR-1', 'HNB Repo Maturing Tomorrow', v_cp_hnb, v_tomorrow - 21, v_tomorrow, 0.1200, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_hnb, v_tomorrow - 21, v_tomorrow, 0.1200, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 25000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_2, 30000000, 102.75, 30825000, 0.95, v_today, 'RECEIVED', 'clean_price:101.75');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_income, 18000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_income, v_bond_3, 22000000, 101.25, 22275000, 0.95, v_today, 'RECEIVED', 'clean_price:100.25');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_balanced, 12000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_balanced, v_bond_4, 15000000, 99.75, 14962500, 0.95, v_today, 'RECEIVED', 'clean_price:98.75');

  -- =============================================
  -- TRADE 9: Maturing DAY AFTER - Sampath - 80M - 4 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'SAMP-MAT-DA-1', 'Sampath Repo Day After Tomorrow', v_cp_sampath, v_day_after - 14, v_day_after, 0.1225, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_sampath, v_day_after - 14, v_day_after, 0.1225, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 25000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_1, 30000000, 102.50, 30750000, 0.95, v_today, 'RECEIVED', 'clean_price:101.50');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_income, 25000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_income, v_bond_2, 30000000, 103.25, 30975000, 0.95, v_today, 'RECEIVED', 'clean_price:102.25');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_balanced, 18000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_balanced, v_bond_3, 22000000, 101.00, 22220000, 0.95, v_today, 'RECEIVED', 'clean_price:100.00');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_pension, 12000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_pension, v_bond_5, 15000000, 99.50, 14925000, 0.95, v_today, 'RECEIVED', 'clean_price:98.50');

  -- =============================================
  -- TRADE 10: Maturing DAY AFTER - Commercial Bank - 35M - 2 clients
  -- =============================================
  v_sec_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_sec_id, v_org_id, v_repo_type_id, 'COMB-MAT-DA-1', 'Commercial Bank Repo Day After', v_cp_comm, v_day_after - 7, v_day_after, 0.1100, 365, 'APPROVED', v_user_id);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_by)
  VALUES (v_trade_id, v_org_id, v_sec_id, v_cp_comm, v_day_after - 7, v_day_after, 0.1100, 365, 'APPROVED', v_user_id);
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_growth, 20000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_growth, v_bond_4, 24000000, 99.25, 23820000, 0.95, v_today, 'RECEIVED', 'clean_price:98.25');
  
  v_alloc_id := gen_random_uuid();
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_alloc_id, v_org_id, v_trade_id, v_pf_balanced, 15000000, 'ACTIVE');
  
  INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref)
  VALUES (v_org_id, v_alloc_id, v_pf_balanced, v_bond_1, 18000000, 102.00, 18360000, 0.95, v_today, 'RECEIVED', 'clean_price:101.00');

  RAISE NOTICE 'Successfully created 10 demo repos for maturity processing';
  RAISE NOTICE 'Today: 5 repos, Tomorrow: 3 repos, Day After: 2 repos';
  
END $$;

-- Verify the data
SELECT 
  s.symbol,
  rt.maturity_date,
  CASE 
    WHEN rt.maturity_date = CURRENT_DATE THEN 'TODAY'
    WHEN rt.maturity_date = CURRENT_DATE + 1 THEN 'TOMORROW'
    WHEN rt.maturity_date = CURRENT_DATE + 2 THEN 'DAY AFTER'
    ELSE 'OTHER'
  END as maturity_bucket,
  c.name as counterparty,
  rt.rate * 100 as rate_pct,
  rt.status,
  (SELECT COUNT(*) FROM repo_allocations ra WHERE ra.repo_trade_id = rt.id) as num_clients,
  (SELECT COALESCE(SUM(ra.principal), 0) FROM repo_allocations ra WHERE ra.repo_trade_id = rt.id) as total_principal
FROM repo_trades rt
JOIN securities s ON rt.repo_security_id = s.id
JOIN counterparties c ON rt.counterparty_id = c.id
WHERE rt.status = 'APPROVED'
  AND rt.maturity_date >= CURRENT_DATE
  AND rt.maturity_date <= CURRENT_DATE + 2
ORDER BY rt.maturity_date, s.symbol;

