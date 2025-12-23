/**
 * Seed 10 approved repo transactions for rollover testing
 * Each transaction has different amounts, clients, counterparties, and collateral
 * Maturity dates are spread over the next 3 days
 * 
 * Run with: npx tsx scripts/seed-rollover-transactions.ts
 * 
 * PREREQUISITE: Run the update_symbol_serial.sql in Supabase SQL Editor first
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://xszzfzhllajtdxywjmmw.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzenpmemhsbGFqdGR4eXdqbW13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzE5NjMsImV4cCI6MjA4MTc0Nzk2M30.sbnQnS3jFPngbWzbCS9zb76onmqvjKCxn54fyyhERxY";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ORG_ID = "11111111-1111-1111-1111-111111111111";

// Helper to format date as YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Generate a unique ID
function generateId(): string {
  return crypto.randomUUID();
}

async function seedRolloverTransactions() {
  console.log("🌱 Seeding 10 approved repo transactions for rollover testing...\n");

  // Get today's date
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch counterparties
  console.log("📋 Fetching counterparties...");
  const { data: counterparties, error: cpError } = await supabase
    .from("counterparties")
    .select("id, name, short_code")
    .eq("org_id", ORG_ID);

  if (cpError || !counterparties?.length) {
    console.error("❌ Failed to fetch counterparties:", cpError?.message);
    console.log("   Please run seed-data.ts first to create reference data.");
    return;
  }
  console.log(`   ✅ Found ${counterparties.length} counterparties\n`);

  // Fetch portfolios
  console.log("📋 Fetching portfolios...");
  const { data: portfolios, error: pfError } = await supabase
    .from("portfolios")
    .select("id, name, code")
    .eq("org_id", ORG_ID);

  if (pfError || !portfolios?.length) {
    console.error("❌ Failed to fetch portfolios:", pfError?.message);
    return;
  }
  console.log(`   ✅ Found ${portfolios.length} portfolios\n`);

  // Fetch security type for repo
  console.log("📋 Fetching security types...");
  const { data: secTypes, error: stError } = await supabase
    .from("security_types")
    .select("id, code, name")
    .eq("org_id", ORG_ID)
    .eq("is_repo_type", true);

  if (stError || !secTypes?.length) {
    console.error("❌ Failed to fetch security types:", stError?.message);
    return;
  }
  const repoSecurityTypeId = secTypes[0].id;
  console.log(`   ✅ Using security type: ${secTypes[0].name}\n`);

  // Fetch bond securities for collateral
  console.log("📋 Fetching bond securities for collateral...");
  const { data: bondSecurities, error: bondError } = await supabase
    .from("securities")
    .select("id, symbol, name")
    .eq("org_id", ORG_ID)
    .not("symbol", "like", "%-%-%-%-%" ); // Exclude repo symbols

  if (bondError) {
    console.error("❌ Failed to fetch bonds:", bondError?.message);
    return;
  }
  // Filter to only bonds (not repo securities)
  const bonds = bondSecurities?.filter(s => s.symbol.startsWith("SLGB") || s.symbol.startsWith("SLTB")) || [];
  console.log(`   ✅ Found ${bonds.length} bond securities\n`);

  // Define 10 transactions with varying parameters
  const transactions = [
    // Day 1 maturity (tomorrow) - 4 transactions
    { counterpartyIdx: 0, portfolioIdx: 0, principal: 5000000, rate: 11.5, tenor: 7, maturityOffset: 1 },
    { counterpartyIdx: 1, portfolioIdx: 1, principal: 3000000, rate: 11.0, tenor: 7, maturityOffset: 1 },
    { counterpartyIdx: 2, portfolioIdx: 2, principal: 7500000, rate: 11.25, tenor: 14, maturityOffset: 1 },
    { counterpartyIdx: 3, portfolioIdx: 3, principal: 2000000, rate: 10.75, tenor: 7, maturityOffset: 1 },
    
    // Day 2 maturity (day after tomorrow) - 3 transactions
    { counterpartyIdx: 4, portfolioIdx: 0, principal: 10000000, rate: 12.0, tenor: 14, maturityOffset: 2 },
    { counterpartyIdx: 0, portfolioIdx: 1, principal: 4500000, rate: 11.5, tenor: 7, maturityOffset: 2 },
    { counterpartyIdx: 1, portfolioIdx: 2, principal: 6000000, rate: 11.75, tenor: 14, maturityOffset: 2 },
    
    // Day 3 maturity - 3 transactions
    { counterpartyIdx: 2, portfolioIdx: 3, principal: 8000000, rate: 11.0, tenor: 21, maturityOffset: 3 },
    { counterpartyIdx: 3, portfolioIdx: 0, principal: 3500000, rate: 10.5, tenor: 7, maturityOffset: 3 },
    { counterpartyIdx: 4, portfolioIdx: 1, principal: 5500000, rate: 11.25, tenor: 14, maturityOffset: 3 }
  ];

  console.log("🔄 Creating 10 approved repo transactions...\n");
  let successCount = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const counterparty = counterparties[tx.counterpartyIdx % counterparties.length];
    const portfolio = portfolios[tx.portfolioIdx % portfolios.length];
    const bond = bonds[i % bonds.length];
    
    // Calculate dates
    const maturityDate = addDays(today, tx.maturityOffset);
    const issueDate = addDays(maturityDate, -tx.tenor);
    
    // Calculate interest
    const dayCountBasis = 365;
    const interest = (tx.principal * (tx.rate / 100) * tx.tenor) / dayCountBasis;
    const maturityValue = tx.principal + interest;

    // Generate symbol using the database function
    const { data: symbolData, error: symbolError } = await supabase.rpc("build_repo_symbol", {
      p_counterparty_id: counterparty.id,
      p_issue_date: formatDate(issueDate),
      p_maturity_date: formatDate(maturityDate),
      p_rate: tx.rate / 100
    });

    if (symbolError) {
      console.error(`   ❌ Trade ${i + 1}: Failed to generate symbol:`, symbolError.message);
      continue;
    }

    const symbol = symbolData as string;
    const securityName = `${counterparty.name} ${formatDate(issueDate)} -> ${formatDate(maturityDate)} @ ${tx.rate.toFixed(2)}%`;

    console.log(`\n📝 Trade ${i + 1}: ${symbol}`);
    console.log(`   Counterparty: ${counterparty.name}`);
    console.log(`   Client: ${portfolio.name}`);
    console.log(`   Principal: LKR ${tx.principal.toLocaleString()}`);
    console.log(`   Rate: ${tx.rate}%`);
    console.log(`   Issue: ${formatDate(issueDate)} | Maturity: ${formatDate(maturityDate)}`);

    // Step 1: Create security
    const securityId = generateId();
    const { error: secError } = await supabase
      .from("securities")
      .insert({
        id: securityId,
        org_id: ORG_ID,
        security_type_id: repoSecurityTypeId,
        symbol: symbol,
        name: securityName,
        maturity_date: formatDate(maturityDate)
      });

    if (secError) {
      console.error(`   ❌ Failed to create security:`, secError.message);
      continue;
    }

    // Step 2: Create repo trade
    const tradeId = generateId();
    const { error: tradeError } = await supabase
      .from("repo_trades")
      .insert({
        id: tradeId,
        org_id: ORG_ID,
        repo_security_id: securityId,
        counterparty_id: counterparty.id,
        issue_date: formatDate(issueDate),
        maturity_date: formatDate(maturityDate),
        rate: tx.rate / 100,
        day_count_basis: dayCountBasis,
        status: "approved",
        notes: `Rollover test transaction ${i + 1}`
      });

    if (tradeError) {
      console.error(`   ❌ Failed to create trade:`, tradeError.message);
      continue;
    }

    // Step 3: Create allocation
    const allocationId = generateId();
    const { error: allocError } = await supabase
      .from("repo_allocations")
      .insert({
        id: allocationId,
        org_id: ORG_ID,
        repo_trade_id: tradeId,
        portfolio_id: portfolio.id,
        principal: tx.principal,
        status: "APPROVED"
      });

    if (allocError) {
      console.error(`   ❌ Failed to create allocation:`, allocError.message);
      continue;
    }

    // Step 4: Create collateral position (if we have bonds)
    if (bond) {
      // Calculate collateral values
      const cleanPrice = 98.5 + (i * 0.3); // Varying clean prices
      const dirtyPrice = cleanPrice + 0.8 + (i * 0.1);
      const nominals = Math.ceil(maturityValue * 1.1 / (dirtyPrice / 100)); // 110% coverage
      const haircut = 0.95 - (i * 0.01); // Varying haircuts 95% to 86%
      const accruedInterest = ((dirtyPrice - cleanPrice) * nominals) / 100;
      const marketValue = (dirtyPrice * nominals / 100) + accruedInterest;
      
      const { error: collError } = await supabase
        .from("collateral_positions")
        .insert({
          org_id: ORG_ID,
          repo_allocation_id: allocationId,
          portfolio_id: portfolio.id,
          collateral_security_id: bond.id,
          face_value: nominals,
          dirty_price: dirtyPrice,
          market_value: marketValue,
          haircut_pct: haircut,
          valuation_date: formatDate(today),
          status: "RECEIVED",
          restricted_flag: true,
          external_custodian_ref: `CP:${cleanPrice.toFixed(2)}|SEED-${i + 1}`
        });

      if (collError) {
        console.error(`   ⚠️ Failed to create collateral:`, collError.message);
      } else {
        console.log(`   📦 Collateral: ${bond.symbol} (${nominals.toLocaleString()} nominals)`);
      }
    }

    successCount++;
    console.log(`   ✅ Created and approved`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`🎉 Successfully created ${successCount}/10 approved transactions!`);
  console.log("=".repeat(60));
  
  // Summary by maturity date
  console.log("\n📅 Maturity Summary:");
  console.log(`   Tomorrow (${formatDate(addDays(today, 1))}): 4 transactions`);
  console.log(`   Day after (${formatDate(addDays(today, 2))}): 3 transactions`);
  console.log(`   In 3 days (${formatDate(addDays(today, 3))}): 3 transactions`);
  
  console.log("\n🔄 These transactions are ready for rollover testing!");
  console.log("   Go to the Rollover page to process them.\n");
}

seedRolloverTransactions().catch(console.error);

