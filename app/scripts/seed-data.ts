/**
 * Seed reference data only (no auth required for insert)
 * Run with: npx tsx scripts/seed-data.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://xszzfzhllajtdxywjmmw.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzenpmemhsbGFqdGR4eXdqbW13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzE5NjMsImV4cCI6MjA4MTc0Nzk2M30.sbnQnS3jFPngbWzbCS9zb76onmqvjKCxn54fyyhERxY";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ORG_ID = "11111111-1111-1111-1111-111111111111";

async function seedData() {
  console.log("🌱 Seeding reference data...\n");

  // Step 1: Create organization
  console.log("🏢 Creating organization...");
  const { data: orgData, error: orgError } = await supabase
    .from("orgs")
    .upsert({ 
      id: ORG_ID,
      name: "Demo Asset Management" 
    }, { onConflict: "id" })
    .select()
    .single();

  if (orgError) {
    console.error("❌ Failed to create org:", orgError.message);
    return;
  }
  console.log(`   ✅ Organization: ${orgData.name}\n`);

  // Step 2: Create config settings
  console.log("⚙️  Creating config settings...");
  const { error: configError } = await supabase
    .from("config_settings")
    .upsert({
      org_id: ORG_ID,
      repo_security_type_codes: "srlk,lrlk",
      default_day_count_basis: 365
    }, { onConflict: "org_id" });

  if (configError) {
    console.error("❌ Failed to create config:", configError.message);
  } else {
    console.log("   ✅ Config settings created\n");
  }

  // Step 3: Create counterparties
  console.log("🏦 Creating counterparties...");
  const counterparties = [
    { org_id: ORG_ID, name: "Bank of Ceylon", short_code: "BOC" },
    { org_id: ORG_ID, name: "People's Bank", short_code: "PB" },
    { org_id: ORG_ID, name: "Commercial Bank", short_code: "COMB" },
    { org_id: ORG_ID, name: "Hatton National Bank", short_code: "HNB" },
    { org_id: ORG_ID, name: "Sampath Bank", short_code: "SAMP" }
  ];

  for (const cp of counterparties) {
    const { error } = await supabase
      .from("counterparties")
      .upsert(cp, { onConflict: "org_id,short_code" });
    
    if (error) {
      console.error(`   ❌ ${cp.name}:`, error.message);
    } else {
      console.log(`   ✅ ${cp.name}`);
    }
  }

  // Step 4: Create security types
  console.log("\n📊 Creating security types...");
  const securityTypes = [
    { org_id: ORG_ID, code: "srlk", name: "Short-term Repo (LKR)", is_repo_type: true },
    { org_id: ORG_ID, code: "lrlk", name: "Long-term Repo (LKR)", is_repo_type: true },
    { org_id: ORG_ID, code: "tbill", name: "Treasury Bill", is_repo_type: false },
    { org_id: ORG_ID, code: "tbond", name: "Treasury Bond", is_repo_type: false }
  ];

  for (const st of securityTypes) {
    const { error } = await supabase
      .from("security_types")
      .upsert(st, { onConflict: "org_id,code" });
    
    if (error) {
      console.error(`   ❌ ${st.name}:`, error.message);
    } else {
      console.log(`   ✅ ${st.name}`);
    }
  }

  // Step 5: Create portfolios
  console.log("\n💼 Creating portfolios...");
  const portfolios = [
    { id: "aaaa1111-1111-1111-1111-111111111111", org_id: ORG_ID, code: "PF-001", name: "Growth Fund Alpha" },
    { id: "aaaa2222-2222-2222-2222-222222222222", org_id: ORG_ID, code: "PF-002", name: "Income Fund Beta" },
    { id: "aaaa3333-3333-3333-3333-333333333333", org_id: ORG_ID, code: "PF-003", name: "Balanced Fund Gamma" },
    { id: "aaaa4444-4444-4444-4444-444444444444", org_id: ORG_ID, code: "PF-004", name: "Money Market Fund" }
  ];

  for (const pf of portfolios) {
    const { error } = await supabase
      .from("portfolios")
      .upsert(pf, { onConflict: "org_id,code" });
    
    if (error) {
      console.error(`   ❌ ${pf.name}:`, error.message);
    } else {
      console.log(`   ✅ ${pf.name}`);
    }
  }

  // Step 6: Create cash accounts
  console.log("\n💵 Creating cash accounts...");
  const cashAccounts = [
    { org_id: ORG_ID, portfolio_id: portfolios[0].id, bank_name: "Bank of Ceylon", account_no: "BOC-001-LKR" },
    { org_id: ORG_ID, portfolio_id: portfolios[1].id, bank_name: "Bank of Ceylon", account_no: "BOC-002-LKR" },
    { org_id: ORG_ID, portfolio_id: portfolios[2].id, bank_name: "Commercial Bank", account_no: "COMB-003-LKR" },
    { org_id: ORG_ID, portfolio_id: portfolios[3].id, bank_name: "People's Bank", account_no: "PB-004-LKR" }
  ];

  for (const ca of cashAccounts) {
    const { error } = await supabase
      .from("cash_accounts")
      .insert(ca);
    
    if (error && !error.message.includes("duplicate")) {
      console.error(`   ❌ ${ca.account_no}:`, error.message);
    } else {
      console.log(`   ✅ ${ca.bank_name} - ${ca.account_no}`);
    }
  }

  // Step 7: Create custody accounts
  console.log("\n🔐 Creating custody accounts...");
  const custodyAccounts = [
    { org_id: ORG_ID, portfolio_id: portfolios[0].id, provider: "CBSL_LankaSecure", account_no: "LS-001" },
    { org_id: ORG_ID, portfolio_id: portfolios[1].id, provider: "CBSL_LankaSecure", account_no: "LS-002" },
    { org_id: ORG_ID, portfolio_id: portfolios[2].id, provider: "CBSL_LankaSecure", account_no: "LS-003" },
    { org_id: ORG_ID, portfolio_id: portfolios[3].id, provider: "CBSL_LankaSecure", account_no: "LS-004" }
  ];

  for (const cu of custodyAccounts) {
    const { error } = await supabase
      .from("custody_accounts")
      .insert(cu);
    
    if (error && !error.message.includes("duplicate")) {
      console.error(`   ❌ ${cu.account_no}:`, error.message);
    } else {
      console.log(`   ✅ ${cu.provider} - ${cu.account_no}`);
    }
  }

  // Step 8: Create bond securities for collateral
  console.log("\n📜 Creating bond securities (for collateral)...");
  
  // First get the security type IDs
  const { data: secTypeData } = await supabase
    .from("security_types")
    .select("id, code")
    .eq("org_id", ORG_ID)
    .in("code", ["tbill", "tbond"]);
  
  const tbillTypeId = secTypeData?.find(st => st.code === "tbill")?.id;
  const tbondTypeId = secTypeData?.find(st => st.code === "tbond")?.id;

  if (tbillTypeId && tbondTypeId) {
    const bonds = [
      { 
        org_id: ORG_ID, 
        security_type_id: tbondTypeId,
        symbol: "SLGB-2028-8.5", 
        name: "Sri Lanka Government Bond 8.5% 2028",
        isin: "LK0230128A51",
        maturity_date: "2028-12-15",
        coupon_rate: 0.085
      },
      { 
        org_id: ORG_ID, 
        security_type_id: tbondTypeId,
        symbol: "SLGB-2030-9.0", 
        name: "Sri Lanka Government Bond 9.0% 2030",
        isin: "LK0230130B62",
        maturity_date: "2030-06-15",
        coupon_rate: 0.09
      },
      { 
        org_id: ORG_ID, 
        security_type_id: tbondTypeId,
        symbol: "SLGB-2027-7.5", 
        name: "Sri Lanka Government Bond 7.5% 2027",
        isin: "LK0230127C73",
        maturity_date: "2027-03-15",
        coupon_rate: 0.075
      },
      { 
        org_id: ORG_ID, 
        security_type_id: tbondTypeId,
        symbol: "SLGB-2029-8.0", 
        name: "Sri Lanka Government Bond 8.0% 2029",
        isin: "LK0230129D84",
        maturity_date: "2029-09-15",
        coupon_rate: 0.08
      },
      { 
        org_id: ORG_ID, 
        security_type_id: tbillTypeId,
        symbol: "SLTB-91D-2025Q1", 
        name: "Sri Lanka T-Bill 91 Day 2025 Q1",
        isin: "LK0191125E95",
        maturity_date: "2025-03-31"
      },
      { 
        org_id: ORG_ID, 
        security_type_id: tbillTypeId,
        symbol: "SLTB-182D-2025Q2", 
        name: "Sri Lanka T-Bill 182 Day 2025 Q2",
        isin: "LK0182125F06",
        maturity_date: "2025-06-30"
      },
      { 
        org_id: ORG_ID, 
        security_type_id: tbillTypeId,
        symbol: "SLTB-364D-2025Q4", 
        name: "Sri Lanka T-Bill 364 Day 2025 Q4",
        isin: "LK0364125G17",
        maturity_date: "2025-12-31"
      }
    ];

    for (const bond of bonds) {
      const { error } = await supabase
        .from("securities")
        .upsert(bond, { onConflict: "org_id,symbol" });
      
      if (error) {
        console.error(`   ❌ ${bond.symbol}:`, error.message);
      } else {
        console.log(`   ✅ ${bond.name}`);
      }
    }
  } else {
    console.log("   ⚠️ Security types not found, skipping bond creation");
  }

  console.log("\n" + "=".repeat(50));
  console.log("🎉 Reference data seeded successfully!");
  console.log("=".repeat(50));
  console.log("\nOrganization ID for manual user linking: " + ORG_ID);
}

seedData().catch(console.error);



