-- Seed 10 approved repo transactions for rollover testing
-- Run this in Supabase SQL Editor AFTER running update_symbol_serial.sql
-- 
-- These transactions have maturity dates over the next 3 days
-- Each has different amounts, clients, counterparties, and collateral

DO $$
DECLARE
  v_org_id uuid := '11111111-1111-1111-1111-111111111111';
  v_today date := current_date;
  
  -- Counterparty IDs
  v_cp_boc uuid;
  v_cp_pb uuid;
  v_cp_comb uuid;
  v_cp_hnb uuid;
  v_cp_samp uuid;
  
  -- Portfolio IDs
  v_pf_growth uuid;
  v_pf_income uuid;
  v_pf_balanced uuid;
  v_pf_mm uuid;
  
  -- Security Type ID for repo
  v_repo_sec_type_id uuid;
  
  -- Bond security IDs for collateral
  v_bond_ids uuid[];
  v_bond_count int;
  
  -- Loop variables
  v_idx int;
  v_security_id uuid;
  v_trade_id uuid;
  v_allocation_id uuid;
  v_symbol text;
  v_sec_name text;
  v_issue_date date;
  v_maturity_date date;
  v_principal numeric;
  v_rate numeric;
  v_tenor int;
  v_interest numeric;
  v_maturity_value numeric;
  v_cp_id uuid;
  v_pf_id uuid;
  v_bond_id uuid;
  v_clean_price numeric;
  v_dirty_price numeric;
  v_nominals numeric;
  v_haircut numeric;
  v_accrued_interest numeric;
  v_market_value numeric;
  
BEGIN
  -- Get counterparty IDs
  SELECT id INTO v_cp_boc FROM counterparties WHERE org_id = v_org_id AND short_code = 'BOC';
  SELECT id INTO v_cp_pb FROM counterparties WHERE org_id = v_org_id AND short_code = 'PB';
  SELECT id INTO v_cp_comb FROM counterparties WHERE org_id = v_org_id AND short_code = 'COMB';
  SELECT id INTO v_cp_hnb FROM counterparties WHERE org_id = v_org_id AND short_code = 'HNB';
  SELECT id INTO v_cp_samp FROM counterparties WHERE org_id = v_org_id AND short_code = 'SAMP';
  
  -- Get portfolio IDs
  SELECT id INTO v_pf_growth FROM portfolios WHERE org_id = v_org_id AND code = 'PF-001';
  SELECT id INTO v_pf_income FROM portfolios WHERE org_id = v_org_id AND code = 'PF-002';
  SELECT id INTO v_pf_balanced FROM portfolios WHERE org_id = v_org_id AND code = 'PF-003';
  SELECT id INTO v_pf_mm FROM portfolios WHERE org_id = v_org_id AND code = 'PF-004';
  
  -- Get repo security type
  SELECT id INTO v_repo_sec_type_id FROM security_types WHERE org_id = v_org_id AND is_repo_type = true LIMIT 1;
  
  -- Get bond IDs for collateral
  SELECT array_agg(id) INTO v_bond_ids 
  FROM securities 
  WHERE org_id = v_org_id 
    AND (symbol LIKE 'SLGB%' OR symbol LIKE 'SLTB%')
  LIMIT 7;
  
  v_bond_count := coalesce(array_length(v_bond_ids, 1), 0);
  
  IF v_cp_boc IS NULL OR v_pf_growth IS NULL OR v_repo_sec_type_id IS NULL THEN
    RAISE EXCEPTION 'Missing reference data. Please run seed-data.ts first.';
  END IF;
  
  RAISE NOTICE 'Starting to create 10 approved repo transactions...';
  RAISE NOTICE 'Today: %', v_today;
  
  -- Transaction 1: BOC, Growth Fund, 5M, 11.5%, maturing tomorrow
  v_idx := 1;
  v_cp_id := v_cp_boc;
  v_pf_id := v_pf_growth;
  v_principal := 5000000;
  v_rate := 0.115;
  v_tenor := 7;
  v_maturity_date := v_today + 1;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Bank of Ceylon ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 11.50%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  -- Collateral
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 98.5;
    v_dirty_price := 99.3;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.95;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 2: PB, Income Fund, 3M, 11.0%, maturing tomorrow
  v_idx := 2;
  v_cp_id := v_cp_pb;
  v_pf_id := v_pf_income;
  v_principal := 3000000;
  v_rate := 0.11;
  v_tenor := 7;
  v_maturity_date := v_today + 1;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Peoples Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 11.00%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 98.8;
    v_dirty_price := 99.6;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.94;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 3: COMB, Balanced Fund, 7.5M, 11.25%, maturing tomorrow
  v_idx := 3;
  v_cp_id := v_cp_comb;
  v_pf_id := v_pf_balanced;
  v_principal := 7500000;
  v_rate := 0.1125;
  v_tenor := 14;
  v_maturity_date := v_today + 1;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Commercial Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 11.25%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 99.1;
    v_dirty_price := 99.9;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.93;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 4: HNB, Money Market Fund, 2M, 10.75%, maturing tomorrow
  v_idx := 4;
  v_cp_id := v_cp_hnb;
  v_pf_id := v_pf_mm;
  v_principal := 2000000;
  v_rate := 0.1075;
  v_tenor := 7;
  v_maturity_date := v_today + 1;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Hatton National Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 10.75%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 99.4;
    v_dirty_price := 100.2;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.92;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 5: SAMP, Growth Fund, 10M, 12.0%, maturing in 2 days
  v_idx := 5;
  v_cp_id := v_cp_samp;
  v_pf_id := v_pf_growth;
  v_principal := 10000000;
  v_rate := 0.12;
  v_tenor := 14;
  v_maturity_date := v_today + 2;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Sampath Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 12.00%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 99.7;
    v_dirty_price := 100.5;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.91;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 6: BOC, Income Fund, 4.5M, 11.5%, maturing in 2 days
  v_idx := 6;
  v_cp_id := v_cp_boc;
  v_pf_id := v_pf_income;
  v_principal := 4500000;
  v_rate := 0.115;
  v_tenor := 7;
  v_maturity_date := v_today + 2;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Bank of Ceylon ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 11.50%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 100.0;
    v_dirty_price := 100.8;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.90;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 7: PB, Balanced Fund, 6M, 11.75%, maturing in 2 days
  v_idx := 7;
  v_cp_id := v_cp_pb;
  v_pf_id := v_pf_balanced;
  v_principal := 6000000;
  v_rate := 0.1175;
  v_tenor := 14;
  v_maturity_date := v_today + 2;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Peoples Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 11.75%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 100.3;
    v_dirty_price := 101.1;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.89;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 8: COMB, Money Market Fund, 8M, 11.0%, maturing in 3 days
  v_idx := 8;
  v_cp_id := v_cp_comb;
  v_pf_id := v_pf_mm;
  v_principal := 8000000;
  v_rate := 0.11;
  v_tenor := 21;
  v_maturity_date := v_today + 3;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Commercial Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 11.00%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 100.6;
    v_dirty_price := 101.4;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.88;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 9: HNB, Growth Fund, 3.5M, 10.5%, maturing in 3 days
  v_idx := 9;
  v_cp_id := v_cp_hnb;
  v_pf_id := v_pf_growth;
  v_principal := 3500000;
  v_rate := 0.105;
  v_tenor := 7;
  v_maturity_date := v_today + 3;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Hatton National Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 10.50%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 100.9;
    v_dirty_price := 101.7;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.87;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  -- Transaction 10: SAMP, Income Fund, 5.5M, 11.25%, maturing in 3 days
  v_idx := 10;
  v_cp_id := v_cp_samp;
  v_pf_id := v_pf_income;
  v_principal := 5500000;
  v_rate := 0.1125;
  v_tenor := 14;
  v_maturity_date := v_today + 3;
  v_issue_date := v_maturity_date - v_tenor;
  v_interest := (v_principal * v_rate * v_tenor) / 365;
  v_maturity_value := v_principal + v_interest;
  v_symbol := public.build_repo_symbol(v_cp_id, v_issue_date, v_maturity_date, v_rate);
  v_sec_name := 'Sampath Bank ' || v_issue_date || ' -> ' || v_maturity_date || ' @ 11.25%';
  
  v_security_id := gen_random_uuid();
  v_trade_id := gen_random_uuid();
  v_allocation_id := gen_random_uuid();
  
  INSERT INTO securities (id, org_id, security_type_id, symbol, name, maturity_date)
  VALUES (v_security_id, v_org_id, v_repo_sec_type_id, v_symbol, v_sec_name, v_maturity_date);
  
  INSERT INTO repo_trades (id, org_id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes)
  VALUES (v_trade_id, v_org_id, v_security_id, v_cp_id, v_issue_date, v_maturity_date, v_rate, 365, 'APPROVED', 'Rollover test ' || v_idx);
  
  INSERT INTO repo_allocations (id, org_id, repo_trade_id, portfolio_id, principal, status)
  VALUES (v_allocation_id, v_org_id, v_trade_id, v_pf_id, v_principal, 'APPROVED');
  
  IF v_bond_count > 0 THEN
    v_bond_id := v_bond_ids[(v_idx - 1) % v_bond_count + 1];
    v_clean_price := 101.2;
    v_dirty_price := 102.0;
    v_nominals := ceil(v_maturity_value * 1.1 / (v_dirty_price / 100));
    v_haircut := 0.86;
    v_accrued_interest := ((v_dirty_price - v_clean_price) * v_nominals) / 100;
    v_market_value := (v_dirty_price * v_nominals / 100) + v_accrued_interest;
    
    INSERT INTO collateral_positions (org_id, repo_allocation_id, portfolio_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, restricted_flag, external_custodian_ref)
    VALUES (v_org_id, v_allocation_id, v_pf_id, v_bond_id, v_nominals, v_dirty_price, v_market_value, v_haircut, v_today, 'RECEIVED', true, 'CP:' || v_clean_price || '|SEED-' || v_idx);
  END IF;
  
  RAISE NOTICE 'Created transaction %: % - LKR % (maturing %)', v_idx, v_symbol, v_principal, v_maturity_date;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '🎉 Successfully created 10 approved repo transactions!';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE '📅 Maturity Summary:';
  RAISE NOTICE '   Tomorrow (%): 4 transactions (LKR 17.5M)', v_today + 1;
  RAISE NOTICE '   Day after (%): 3 transactions (LKR 20.5M)', v_today + 2;
  RAISE NOTICE '   In 3 days (%): 3 transactions (LKR 17M)', v_today + 3;
  RAISE NOTICE '';
  RAISE NOTICE '🔄 These transactions are ready for rollover testing!';
  
END;
$$ LANGUAGE plpgsql;

