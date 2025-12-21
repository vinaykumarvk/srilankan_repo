/**
 * Seed script to create test user and required reference data
 * Run with: npx tsx scripts/seed.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xszzfzhllajtdxywjmmw.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzenpmemhsbGFqdGR4eXdqbW13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzE5NjMsImV4cCI6MjA4MTc0Nzk2M30.sbnQnS3jFPngbWzbCS9zb76onmqvjKCxn54fyyhERxY";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Test user credentials
const TEST_EMAIL = "srilankarepo.demo@gmail.com";
const TEST_PASSWORD = "Demo123!@#";

async function seed() {
  console.log("🌱 Starting seed process...\n");

  // Step 1: Sign up test user
  console.log("📧 Creating test user...");
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    options: {
      data: {
        display_name: "Demo User"
      }
    }
  });

  if (authError) {
    // If user already exists, try to sign in
    if (authError.message.includes("already registered")) {
      console.log("   User already exists, signing in...");
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD
      });
      
      if (signInError) {
        console.error("❌ Failed to sign in:", signInError.message);
        process.exit(1);
      }
      
      console.log("   ✅ Signed in as existing user");
    } else {
      console.error("❌ Failed to create user:", authError.message);
      process.exit(1);
    }
  } else {
    console.log("   ✅ User created successfully");
    
    // Sign in to get session
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });
    
    if (signInError) {
      console.log("   ⚠️  Note: Email confirmation may be required. Check Supabase dashboard.");
    }
  }

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    console.log("\n⚠️  User created but email confirmation may be required.");
    console.log("   Please check Supabase Auth dashboard and confirm the user email.");
    console.log("\n📋 Test Credentials:");
    console.log(`   Email: ${TEST_EMAIL}`);
    console.log(`   Password: ${TEST_PASSWORD}`);
    return;
  }

  console.log(`   User ID: ${user.id}\n`);

  // Step 2: Create organization
  console.log("🏢 Creating organization...");
  const { data: orgData, error: orgError } = await supabase
    .from("orgs")
    .upsert({ 
      id: "11111111-1111-1111-1111-111111111111",
      name: "Demo Asset Management" 
    }, { onConflict: "id" })
    .select()
    .single();

  if (orgError) {
    console.error("❌ Failed to create org:", orgError.message);
  } else {
    console.log(`   ✅ Organization: ${orgData.name}`);
  }

  const orgId = "11111111-1111-1111-1111-111111111111";

  // Step 3: Link user to organization
  console.log("\n👤 Linking user to organization...");
  const { error: memberError } = await supabase
    .from("org_members")
    .upsert({
      org_id: orgId,
      user_id: user.id,
      role: "FO_TRADER"
    }, { onConflict: "org_id,user_id" });

  if (memberError) {
    console.error("❌ Failed to link user:", memberError.message);
  } else {
    console.log("   ✅ User linked as FO_TRADER");
  }

  // Step 4: Create config settings
  console.log("\n⚙️  Creating config settings...");
  const { error: configError } = await supabase
    .from("config_settings")
    .upsert({
      org_id: orgId,
      repo_security_type_codes: "srlk,lrlk",
      default_day_count_basis: 365
    }, { onConflict: "org_id" });

  if (configError) {
    console.error("❌ Failed to create config:", configError.message);
  } else {
    console.log("   ✅ Config settings created");
  }

  // Step 5: Create counterparties
  console.log("\n🏦 Creating counterparties...");
  const counterparties = [
    { org_id: orgId, name: "Bank of Ceylon", short_code: "BOC" },
    { org_id: orgId, name: "People's Bank", short_code: "PB" },
    { org_id: orgId, name: "Commercial Bank", short_code: "COMB" },
    { org_id: orgId, name: "Hatton National Bank", short_code: "HNB" },
    { org_id: orgId, name: "Sampath Bank", short_code: "SAMP" }
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

  // Step 6: Create security types
  console.log("\n📊 Creating security types...");
  const securityTypes = [
    { org_id: orgId, code: "srlk", name: "Short-term Repo (LKR)", is_repo_type: true },
    { org_id: orgId, code: "lrlk", name: "Long-term Repo (LKR)", is_repo_type: true },
    { org_id: orgId, code: "tbill", name: "Treasury Bill", is_repo_type: false },
    { org_id: orgId, code: "tbond", name: "Treasury Bond", is_repo_type: false }
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

  // Step 7: Create portfolios
  console.log("\n💼 Creating portfolios...");
  const portfolios = [
    { id: "aaaa1111-1111-1111-1111-111111111111", org_id: orgId, code: "PF-001", name: "Growth Fund Alpha" },
    { id: "aaaa2222-2222-2222-2222-222222222222", org_id: orgId, code: "PF-002", name: "Income Fund Beta" },
    { id: "aaaa3333-3333-3333-3333-333333333333", org_id: orgId, code: "PF-003", name: "Balanced Fund Gamma" },
    { id: "aaaa4444-4444-4444-4444-444444444444", org_id: orgId, code: "PF-004", name: "Money Market Fund" }
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

  // Step 8: Create cash accounts
  console.log("\n💵 Creating cash accounts...");
  const cashAccounts = [
    { org_id: orgId, portfolio_id: portfolios[0].id, bank_name: "Bank of Ceylon", account_no: "BOC-001-LKR" },
    { org_id: orgId, portfolio_id: portfolios[1].id, bank_name: "Bank of Ceylon", account_no: "BOC-002-LKR" },
    { org_id: orgId, portfolio_id: portfolios[2].id, bank_name: "Commercial Bank", account_no: "COMB-003-LKR" },
    { org_id: orgId, portfolio_id: portfolios[3].id, bank_name: "People's Bank", account_no: "PB-004-LKR" }
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

  // Step 9: Create custody accounts
  console.log("\n🔐 Creating custody accounts...");
  const custodyAccounts = [
    { org_id: orgId, portfolio_id: portfolios[0].id, provider: "CBSL_LankaSecure", account_no: "LS-001" },
    { org_id: orgId, portfolio_id: portfolios[1].id, provider: "CBSL_LankaSecure", account_no: "LS-002" },
    { org_id: orgId, portfolio_id: portfolios[2].id, provider: "CBSL_LankaSecure", account_no: "LS-003" },
    { org_id: orgId, portfolio_id: portfolios[3].id, provider: "CBSL_LankaSecure", account_no: "LS-004" }
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

  console.log("\n" + "=".repeat(50));
  console.log("🎉 Seed completed!\n");
  console.log("📋 Test Credentials:");
  console.log(`   Email: ${TEST_EMAIL}`);
  console.log(`   Password: ${TEST_PASSWORD}`);
  console.log("=".repeat(50));
}

seed().catch(console.error);

