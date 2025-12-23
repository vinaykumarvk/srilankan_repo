"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";

// Types
type Counterparty = { id: string; name: string; short_code: string };
type Portfolio = { id: string; name: string; code: string };
type SecurityType = { id: string; code: string; name: string };

type Allocation = {
  id: string;
  portfolio_id: string;
  principal: number;
  reinvest_interest: boolean;
  capital_adjustment: number;
  status: string;
  portfolios: { id: string; name: string; code: string } | null;
};

type RepoTrade = {
  id: string;
  repo_security_id: string;
  counterparty_id: string;
  issue_date: string;
  maturity_date: string;
  rate: number;
  day_count_basis: number;
  status: string;
  notes: string | null;
  securities: { id: string; symbol: string; name: string } | null;
  counterparties: { id: string; name: string; short_code: string } | null;
  repo_allocations: Allocation[];
};

type NewAllocation = {
  id: string;
  portfolioId: string;
  portfolioName: string;
  portfolioCode: string;
  oldPrincipal: number;
  oldInterest: number;
  principalAdjustment: number;
  interestAction: "reinvest" | "payout";
  newPrincipal: number;
  rolloverAmount: number;
  included: boolean;
};

// Helper functions
function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatInterest(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateInterest(principal: number, rate: number, tenor: number, dayCountBasis: number): number {
  return (principal * rate * tenor) / dayCountBasis;
}

export default function MaturityProcessingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  // Reference data
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [securityTypes, setSecurityTypes] = useState<SecurityType[]>([]);

  // Maturing trades
  const [repoTrades, setRepoTrades] = useState<RepoTrade[]>([]);

  // Selected trade for action
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<"close" | "rollover" | null>(null);

  // New repo draft (for rollover)
  const [newCounterpartyId, setNewCounterpartyId] = useState<string>("");
  const [newRate, setNewRate] = useState<string>("");
  const [newTenor, setNewTenor] = useState<string>("");
  const [newDayCount, setNewDayCount] = useState<string>("365");
  const [newIssueDate, setNewIssueDate] = useState<string>("");
  const [newMaturityDate, setNewMaturityDate] = useState<string>("");
  const [newSymbol, setNewSymbol] = useState<string>("");
  const [newAllocations, setNewAllocations] = useState<NewAllocation[]>([]);

  // Processing state
  const [processing, setProcessing] = useState(false);

  // Initialize
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to access maturity processing.");
        setLoading(false);
        return;
      }
      setUserId(authData.user.id);

      const { data: memberData, error: memberError } = await supabase
        .from("org_members")
        .select("org_id")
        .eq("user_id", authData.user.id)
        .single();

      if (memberError || !memberData) {
        setError("No organization membership found.");
        setLoading(false);
        return;
      }

      setOrgId(memberData.org_id);
      await loadData(memberData.org_id);
      setLoading(false);
    };

    init().catch(err => {
      console.error("Init error:", err);
      setError(err.message || "Failed to initialize");
      setLoading(false);
    });
  }, []);

  const loadData = async (targetOrgId: string) => {
    const today = new Date().toISOString().split("T")[0];

    const [counterpartyRes, portfolioRes, secTypeRes, tradesRes] = await Promise.all([
      supabase.from("counterparties").select("id, name, short_code").eq("org_id", targetOrgId),
      supabase.from("portfolios").select("id, name, code").eq("org_id", targetOrgId),
      supabase.from("security_types").select("id, code, name").eq("org_id", targetOrgId).eq("is_repo_type", true),
      supabase
        .from("repo_trades")
        .select(`
          id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, notes,
          securities ( id, symbol, name ),
          counterparties ( id, name, short_code ),
          repo_allocations ( id, portfolio_id, principal, reinvest_interest, capital_adjustment, status, portfolios ( id, name, code ) )
        `)
        .eq("org_id", targetOrgId)
        .in("status", ["APPROVED", "ACTIVE", "POSTED"])
        .gte("maturity_date", today)
        .order("maturity_date", { ascending: true })
    ]);

    if (counterpartyRes.error) { setError(`Failed to load counterparties: ${counterpartyRes.error.message}`); return; }
    if (portfolioRes.error) { setError(`Failed to load portfolios: ${portfolioRes.error.message}`); return; }
    if (secTypeRes.error) { setError(`Failed to load security types: ${secTypeRes.error.message}`); return; }
    if (tradesRes.error) { setError(`Failed to load trades: ${tradesRes.error.message}`); return; }

    setCounterparties((counterpartyRes.data as Counterparty[]) || []);
    setPortfolios((portfolioRes.data as Portfolio[]) || []);
    setSecurityTypes((secTypeRes.data as SecurityType[]) || []);
    setRepoTrades((tradesRes.data as unknown as RepoTrade[]) || []);
  };

  // Calculate trade summary
  const calculateTradeSummary = (trade: RepoTrade) => {
    const tenor = daysBetween(trade.issue_date, trade.maturity_date);
    let totalPrincipal = 0;
    let totalInterest = 0;

    trade.repo_allocations.forEach(alloc => {
      totalPrincipal += alloc.principal;
      totalInterest += calculateInterest(alloc.principal, trade.rate, tenor, trade.day_count_basis);
    });

    const totalMaturityValue = totalPrincipal + totalInterest;
    const daysToMaturity = daysBetween(new Date().toISOString().split("T")[0], trade.maturity_date);

    return { tenor, totalPrincipal, totalInterest, totalMaturityValue, daysToMaturity };
  };

  // Start rollover - initialize new repo draft from old trade
  const startRollover = (trade: RepoTrade) => {
    const oldTenor = daysBetween(trade.issue_date, trade.maturity_date);
    const issueDate = addDays(trade.maturity_date, 1);
    const maturityDate = addDays(issueDate, oldTenor);

    setSelectedTradeId(trade.id);
    setActionMode("rollover");
    setNewCounterpartyId(trade.counterparty_id);
    setNewRate((trade.rate * 100).toFixed(2));
    setNewTenor(oldTenor.toString());
    setNewDayCount(trade.day_count_basis.toString());
    setNewIssueDate(issueDate);
    setNewMaturityDate(maturityDate);
    setNewSymbol("");

    // Initialize allocations from old trade
    const allocations: NewAllocation[] = trade.repo_allocations.map(alloc => {
      const oldInterest = calculateInterest(alloc.principal, trade.rate, oldTenor, trade.day_count_basis);
      return {
        id: crypto.randomUUID(),
        portfolioId: alloc.portfolio_id,
        portfolioName: alloc.portfolios?.name || "Unknown",
        portfolioCode: alloc.portfolios?.code || "",
        oldPrincipal: alloc.principal,
        oldInterest,
        principalAdjustment: 0,
        interestAction: "reinvest" as const,
        newPrincipal: alloc.principal,
        rolloverAmount: alloc.principal + oldInterest,
        included: true
      };
    });

    setNewAllocations(allocations);
  };

  // Start close
  const startClose = (trade: RepoTrade) => {
    setSelectedTradeId(trade.id);
    setActionMode("close");
  };

  // Cancel action
  const cancelAction = () => {
    setSelectedTradeId(null);
    setActionMode(null);
    setNewAllocations([]);
    setNewSymbol("");
  };

  // Update tenor and recalculate maturity date
  useEffect(() => {
    if (newIssueDate && newTenor) {
      const tenor = parseInt(newTenor);
      if (!isNaN(tenor) && tenor > 0) {
        setNewMaturityDate(addDays(newIssueDate, tenor));
      }
    }
  }, [newTenor, newIssueDate]);

  // Generate symbol when key fields change
  useEffect(() => {
    const generateSymbol = async () => {
      const rate = parseFloat(newRate) / 100;
      if (!newCounterpartyId || !newIssueDate || !newMaturityDate || isNaN(rate) || rate <= 0) {
        setNewSymbol("");
        return;
      }

      console.log("Generating symbol with:", { newCounterpartyId, newIssueDate, newMaturityDate, rate });

      const { data, error } = await supabase.rpc("build_repo_symbol", {
        p_counterparty_id: newCounterpartyId,
        p_issue_date: newIssueDate,
        p_maturity_date: newMaturityDate,
        p_rate: rate
      });

      console.log("Symbol generation result:", { data, error });

      if (!error && data) {
        setNewSymbol(data as string);
      } else if (error) {
        console.error("Symbol generation error:", error);
      }
    };

    if (actionMode === "rollover") {
      generateSymbol();
    }
  }, [newCounterpartyId, newIssueDate, newMaturityDate, newRate, actionMode]);

  // Recalculate allocations when rate/tenor/daycount changes
  useEffect(() => {
    if (actionMode !== "rollover" || newAllocations.length === 0) return;

    const rate = parseFloat(newRate) / 100;
    const tenor = parseInt(newTenor);
    const dayCount = parseInt(newDayCount);
    if (isNaN(rate) || isNaN(tenor) || isNaN(dayCount)) return;

    setNewAllocations(prev => prev.map(alloc => {
      const newPrincipal = alloc.oldPrincipal + alloc.principalAdjustment;
      const rolloverAmount = newPrincipal + (alloc.interestAction === "reinvest" ? alloc.oldInterest : 0);
      return { ...alloc, newPrincipal, rolloverAmount };
    }));
  }, [newRate, newTenor, newDayCount, actionMode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.actions-dropdown')) {
        document.querySelectorAll('.dropdown-menu.show').forEach(el => {
          el.classList.remove('show');
        });
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Update allocation
  const updateAllocation = (id: string, updates: Partial<NewAllocation>) => {
    const rate = parseFloat(newRate) / 100;
    const tenor = parseInt(newTenor);
    const dayCount = parseInt(newDayCount);

    setNewAllocations(prev => prev.map(alloc => {
      if (alloc.id !== id) return alloc;
      const updated = { ...alloc, ...updates };
      updated.newPrincipal = updated.oldPrincipal + updated.principalAdjustment;
      updated.rolloverAmount = updated.newPrincipal + (updated.interestAction === "reinvest" ? updated.oldInterest : 0);
      return updated;
    }));
  };

  // Add new client allocation
  const addNewClient = (portfolioId: string) => {
    const portfolio = portfolios.find(p => p.id === portfolioId);
    if (!portfolio) return;

    // Check if already exists
    if (newAllocations.some(a => a.portfolioId === portfolioId)) {
      setError("This client is already in the allocation list.");
      return;
    }

    const newAlloc: NewAllocation = {
      id: crypto.randomUUID(),
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      portfolioCode: portfolio.code,
      oldPrincipal: 0,
      oldInterest: 0,
      principalAdjustment: 0,
      interestAction: "reinvest",
      newPrincipal: 0,
      rolloverAmount: 0,
      included: true
    };

    setNewAllocations(prev => [...prev, newAlloc]);
  };

  // Remove client allocation
  const removeAllocation = (id: string) => {
    setNewAllocations(prev => prev.filter(a => a.id !== id));
  };

  // Get available clients (not already in allocations)
  const availableClients = useMemo(() => {
    const usedIds = new Set(newAllocations.map(a => a.portfolioId));
    return portfolios.filter(p => !usedIds.has(p.id));
  }, [portfolios, newAllocations]);

  // Calculate new repo totals
  const newRepoTotals = useMemo(() => {
    const included = newAllocations.filter(a => a.included);
    const rate = parseFloat(newRate) / 100;
    const tenor = parseInt(newTenor);
    const dayCount = parseInt(newDayCount);

    const totalRolloverAmount = included.reduce((sum, a) => sum + a.rolloverAmount, 0);
    const totalNewInterest = !isNaN(rate) && !isNaN(tenor) && !isNaN(dayCount) 
      ? calculateInterest(totalRolloverAmount, rate, tenor, dayCount) 
      : 0;
    const totalMaturityValue = totalRolloverAmount + totalNewInterest;
    const totalInterestPaidOut = included
      .filter(a => a.interestAction === "payout")
      .reduce((sum, a) => sum + a.oldInterest, 0);

    return {
      count: included.length,
      totalRolloverAmount,
      totalNewInterest,
      totalMaturityValue,
      totalInterestPaidOut
    };
  }, [newAllocations, newRate, newTenor, newDayCount]);

  // Execute close
  const executeClose = async () => {
    const trade = repoTrades.find(t => t.id === selectedTradeId);
    if (!trade || !orgId) return;

    setProcessing(true);
    setError(null);

    try {
      await supabase.from("repo_trades").update({ status: "CLOSED" }).eq("id", trade.id);
      await supabase.from("repo_allocations").update({ status: "CLOSED" }).eq("repo_trade_id", trade.id);

      // Return collateral
      for (const alloc of trade.repo_allocations) {
        await supabase.from("collateral_positions").update({ status: "RETURNED" }).eq("repo_allocation_id", alloc.id);
      }

      setSuccessMessage(`Trade ${trade.securities?.symbol} closed successfully.`);
      cancelAction();
      await loadData(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Close failed");
    } finally {
      setProcessing(false);
    }
  };

  // Execute rollover - create new repo
  const executeRollover = async () => {
    console.log("executeRollover called", { selectedTradeId, orgId, newSymbol });
    
    const oldTrade = repoTrades.find(t => t.id === selectedTradeId);
    if (!oldTrade || !orgId || !newSymbol) {
      console.error("Missing required data:", { oldTrade: !!oldTrade, orgId, newSymbol });
      setError(`Cannot proceed: ${!oldTrade ? "Trade not found" : !orgId ? "Organization not set" : "Symbol not generated"}`);
      return;
    }

    const includedAllocations = newAllocations.filter(a => a.included);
    if (includedAllocations.length === 0) {
      setError("Please include at least one client allocation.");
      return;
    }

    console.log("Starting rollover with:", { oldTrade: oldTrade.id, allocations: includedAllocations.length });
    setProcessing(true);
    setError(null);

    try {
      const rate = parseFloat(newRate) / 100;
      const dayCount = parseInt(newDayCount);
      const counterparty = counterparties.find(c => c.id === newCounterpartyId);
      const securityName = `${counterparty?.name || "Repo"} ${newIssueDate} -> ${newMaturityDate} @ ${newRate}%`;

      const { data: oldSecData } = await supabase
        .from("securities")
        .select("security_type_id")
        .eq("id", oldTrade.repo_security_id)
        .single();

      const securityTypeId = oldSecData?.security_type_id || securityTypes[0]?.id;

      // Create new security
      const newSecurityId = crypto.randomUUID();
      const { error: secError } = await supabase.from("securities").insert({
        id: newSecurityId,
        org_id: orgId,
        security_type_id: securityTypeId,
        symbol: newSymbol,
        name: securityName,
        maturity_date: newMaturityDate
      });
      if (secError) throw new Error(`Failed to create security: ${secError.message}`);

      // Create new repo trade
      const newTradeId = crypto.randomUUID();
      const { error: tradeError } = await supabase.from("repo_trades").insert({
        id: newTradeId,
        org_id: orgId,
        repo_security_id: newSecurityId,
        counterparty_id: newCounterpartyId,
        issue_date: newIssueDate,
        maturity_date: newMaturityDate,
        rate: rate,
        day_count_basis: dayCount,
        status: "PENDING_APPROVAL",
        notes: `Rolled over from ${oldTrade.securities?.symbol || "previous trade"}`,
        created_by: userId
      });
      if (tradeError) throw new Error(`Failed to create trade: ${tradeError.message}`);

      // Create allocations and replicate collateral automatically
      for (const alloc of includedAllocations) {
        const newAllocationId = crypto.randomUUID();

        const { error: allocError } = await supabase.from("repo_allocations").insert({
          id: newAllocationId,
          org_id: orgId,
          repo_trade_id: newTradeId,
          portfolio_id: alloc.portfolioId,
          principal: alloc.rolloverAmount,
          reinvest_interest: alloc.interestAction === "reinvest",
          capital_adjustment: alloc.principalAdjustment,
          status: "DRAFT"
        });
        if (allocError) throw new Error(`Failed to create allocation: ${allocError.message}`);

        // Get old allocation ID for this portfolio
        const oldAlloc = oldTrade.repo_allocations.find(a => a.portfolio_id === alloc.portfolioId);
        if (oldAlloc) {
          // Copy collateral from old allocation to new allocation
          const { data: oldCollateral } = await supabase
            .from("collateral_positions")
            .select("*")
            .eq("repo_allocation_id", oldAlloc.id)
            .in("status", ["RECEIVED", "ACTIVE"]);

          if (oldCollateral && oldCollateral.length > 0) {
            for (const cp of oldCollateral) {
              await supabase.from("collateral_positions").insert({
                org_id: orgId,
                repo_allocation_id: newAllocationId,
                portfolio_id: alloc.portfolioId,
                collateral_security_id: cp.collateral_security_id,
                face_value: cp.face_value,
                dirty_price: cp.dirty_price,
                market_value: cp.market_value,
                haircut_pct: cp.haircut_pct,
                valuation_date: new Date().toISOString().split("T")[0],
                status: "RECEIVED",
                restricted_flag: true,
                external_custodian_ref: cp.external_custodian_ref
              });
            }
          }
        }
      }

      // Mark old trade as rolled
      await supabase.from("repo_trades").update({ status: "ROLLED" }).eq("id", oldTrade.id);
      await supabase.from("repo_allocations").update({ status: "ROLLED" }).eq("repo_trade_id", oldTrade.id);

      setSuccessMessage(`New repo with symbol ${newSymbol} created and is available for approval. Old trade marked as rolled.`);
      cancelAction();
      await loadData(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollover failed");
    } finally {
      setProcessing(false);
    }
  };

  // Get selected trade
  const selectedTrade = useMemo(() => repoTrades.find(t => t.id === selectedTradeId), [selectedTradeId, repoTrades]);

  if (loading) {
    return (
      <main className="maturity-page">
        <section className="loading-section">
          <div className="loading-spinner"></div>
          <p>Loading maturity data...</p>
        </section>
      </main>
    );
  }

  if (error && repoTrades.length === 0) {
    return (
      <main className="maturity-page">
        <section className="error-section">
          <p>{error}</p>
          <button className="primary" onClick={() => { setError(null); if (orgId) loadData(orgId); }}>Retry</button>
        </section>
      </main>
    );
  }

  return (
    <main className="maturity-page">
      {successMessage && (
        <div className="success-banner">
          <p>✅ {successMessage}</p>
          <button className="ghost" onClick={() => setSuccessMessage(null)}>Dismiss</button>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <p>❌ {error}</p>
          <button className="ghost" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {repoTrades.length === 0 ? (
        <div className="empty-state">
          <p>No approved repos maturing today or in the future.</p>
        </div>
      ) : (
        <div className="maturity-trades-list">
          {repoTrades.map(trade => {
            const summary = calculateTradeSummary(trade);
            const isSelected = selectedTradeId === trade.id;
            const isToday = trade.maturity_date === new Date().toISOString().split("T")[0];
            const isTomorrow = trade.maturity_date === addDays(new Date().toISOString().split("T")[0], 1);

            return (
              <div key={trade.id} className={`maturity-trade-block ${isSelected ? "expanded" : ""}`}>
                {/* Horizontal Card - Old Trade */}
                <div className={`maturity-card-horizontal ${isToday ? "today" : ""} ${isTomorrow ? "tomorrow" : ""}`}>
                  <div className="card-row-main">
                    <div className="card-section symbol-section">
                      <div className="symbol">{trade.securities?.symbol || "N/A"}</div>
                      <div className={`maturity-badge ${summary.daysToMaturity <= 1 ? "urgent" : ""}`}>
                        {summary.daysToMaturity === 0 ? "Today" : summary.daysToMaturity === 1 ? "Tomorrow" : `${summary.daysToMaturity}d`}
                      </div>
                    </div>

                    <div className="card-section">
                      <span className="label">Counterparty</span>
                      <span className="value">{trade.counterparties?.name || "Unknown"}</span>
                    </div>

                    <div className="card-section">
                      <span className="label">Principal</span>
                      <span className="value">LKR {formatCurrency(summary.totalPrincipal)}</span>
                    </div>

                    <div className="card-section">
                      <span className="label">Maturity</span>
                      <span className="value highlight-value">LKR {formatInterest(summary.totalMaturityValue)}</span>
                    </div>

                    <div className="card-section compact">
                      <span className="compact-info">{(trade.rate * 100).toFixed(2)}% • {summary.tenor}d</span>
                      <span className="compact-info">{trade.repo_allocations.length} client{trade.repo_allocations.length !== 1 ? "s" : ""}</span>
                    </div>

                    <div className="card-section actions-section">
                      {!isSelected ? (
                        <div className="action-buttons-row">
                          <button className="action-btn close-action" onClick={() => startClose(trade)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <circle cx="12" cy="12" r="10"/>
                              <line x1="15" y1="9" x2="9" y2="15"/>
                              <line x1="9" y1="9" x2="15" y2="15"/>
                            </svg>
                            Close
                          </button>
                          <button className="action-btn rollover-action" onClick={() => startRollover(trade)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="23 4 23 10 17 10"/>
                              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                            Rollover
                          </button>
                        </div>
                      ) : (
                        <button className="cancel-btn" onClick={cancelAction}>✕</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Close Confirmation */}
                {isSelected && actionMode === "close" && (
                  <div className="action-panel close-panel">
                    <div className="panel-header">
                      <h3>⚠️ Close Trade</h3>
                      <p>This will mark the trade as closed and return all collateral.</p>
                    </div>
                    <div className="panel-actions">
                      <button className="secondary" onClick={cancelAction} disabled={processing}>Cancel</button>
                      <button className="danger" onClick={executeClose} disabled={processing}>
                        {processing ? "Processing..." : "Confirm Close"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Rollover - New Repo Form */}
                {isSelected && actionMode === "rollover" && (
                  <div className="action-panel rollover-panel">
                    <div className="new-repo-section">
                      <header className="section-header">
                        <div>
                          <div className="badge">New Repo • Rollover</div>
                          <h2>New Repo Details</h2>
                        </div>
                        <button 
                          className="primary" 
                          onClick={executeRollover} 
                          disabled={processing || newRepoTotals.count === 0 || !newSymbol}
                        >
                          {processing ? "Processing..." : "Submit for Approval"}
                        </button>
                      </header>

                      {/* Summary Card */}
                      <div className="summary-card inline-summary">
                        <div className="summary-item">
                          <label>Total Principal</label>
                          <div>LKR {formatInterest(newRepoTotals.totalRolloverAmount)}</div>
                        </div>
                        <div className="summary-item">
                          <label>Tenor</label>
                          <div>{newTenor} days</div>
                        </div>
                        <div className="summary-item">
                          <label>Estimated Interest</label>
                          <div>LKR {formatInterest(newRepoTotals.totalNewInterest)}</div>
                        </div>
                        <div className="summary-item highlight">
                          <label>Maturity Value</label>
                          <div>LKR {formatInterest(newRepoTotals.totalMaturityValue)}</div>
                        </div>
                        <div className="summary-item">
                          <label>Day Count</label>
                          <div>{newDayCount === "365" ? "ACT/365" : "ACT/360"}</div>
                        </div>
                      </div>

                      {/* Form Grid - matching New Repo page */}
                      <div className="section-grid">
                        <div>
                          <label>Counterparty</label>
                          <select value={newCounterpartyId} onChange={(e) => setNewCounterpartyId(e.target.value)}>
                            {counterparties.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label>Issue Date</label>
                          <input type="date" value={newIssueDate} className="disabled-input" disabled />
                        </div>
                        <div>
                          <label>Maturity Date</label>
                          <input type="date" value={newMaturityDate} className="disabled-input" disabled />
                        </div>
                        <div>
                          <label>Rate (%)</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            value={newRate} 
                            onChange={(e) => setNewRate(e.target.value)}
                            placeholder="Enter rate"
                          />
                        </div>
                        <div>
                          <label>Day Count Convention</label>
                          <select value={newDayCount} onChange={(e) => setNewDayCount(e.target.value)}>
                            <option value="365">ACT/365</option>
                            <option value="360">ACT/360</option>
                          </select>
                        </div>
                        <div>
                          <label>Tenor (days)</label>
                          <input type="number" value={newTenor} onChange={(e) => setNewTenor(e.target.value)} />
                        </div>
                      </div>

                      {/* Symbol */}
                      <div className="symbol-section-form">
                        <label>Symbol</label>
                        <input 
                          type="text" 
                          value={newSymbol || "Fill fields above to generate"} 
                          readOnly 
                          className={`symbol-input ${newSymbol ? "generated" : "pending"}`}
                        />
                      </div>

                      {/* Client Allocations */}
                      <div className="allocations-section">
                        <div className="allocations-header">
                          <h3>Client Allocations</h3>
                          {availableClients.length > 0 && (
                            <div className="add-client-row">
                              <select 
                                id="add-client-select"
                                defaultValue=""
                                onChange={(e) => {
                                  if (e.target.value) {
                                    addNewClient(e.target.value);
                                    e.target.value = "";
                                  }
                                }}
                              >
                                <option value="">+ Add Client</option>
                                {availableClients.map(p => (
                                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <table className="allocations-table">
                          <thead>
                            <tr>
                              <th>Include</th>
                              <th>Client</th>
                              <th>Old Principal</th>
                              <th>Principal +/-</th>
                              <th>New Principal</th>
                              <th>Old Interest</th>
                              <th>Interest</th>
                              <th>Rollover Amount</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {newAllocations.map(alloc => (
                              <tr key={alloc.id} className={!alloc.included ? "excluded" : ""}>
                                <td>
                                  <input 
                                    type="checkbox" 
                                    checked={alloc.included} 
                                    onChange={() => updateAllocation(alloc.id, { included: !alloc.included })} 
                                  />
                                </td>
                                <td>
                                  <div className="client-name">{alloc.portfolioName}</div>
                                  <div className="client-code">{alloc.portfolioCode}</div>
                                </td>
                                <td className="number">
                                  {alloc.oldPrincipal > 0 ? `LKR ${formatCurrency(alloc.oldPrincipal)}` : <span className="new-client-badge">New</span>}
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    value={alloc.principalAdjustment}
                                    onChange={(e) => updateAllocation(alloc.id, { principalAdjustment: parseFloat(e.target.value) || 0 })}
                                    disabled={!alloc.included}
                                    className="principal-input"
                                    step="1000"
                                    placeholder={alloc.oldPrincipal === 0 ? "Enter amount" : "0"}
                                  />
                                </td>
                                <td className="number">LKR {formatInterest(alloc.newPrincipal)}</td>
                                <td className="number">
                                  {alloc.oldInterest > 0 ? `LKR ${formatInterest(alloc.oldInterest)}` : "-"}
                                </td>
                                <td>
                                  {alloc.oldInterest > 0 ? (
                                    <select
                                      value={alloc.interestAction}
                                      onChange={(e) => updateAllocation(alloc.id, { interestAction: e.target.value as "reinvest" | "payout" })}
                                      disabled={!alloc.included}
                                      className="interest-select"
                                    >
                                      <option value="reinvest">Reinvest</option>
                                      <option value="payout">Payout</option>
                                    </select>
                                  ) : "-"}
                                </td>
                                <td className="number highlight">LKR {formatInterest(alloc.rolloverAmount)}</td>
                                <td>
                                  <button 
                                    className="remove-btn"
                                    onClick={() => removeAllocation(alloc.id)}
                                    title="Remove client"
                                  >
                                    ×
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {newRepoTotals.totalInterestPaidOut > 0 && (
                        <div className="payout-notice">
                          💰 Interest to be paid out: <strong>LKR {formatInterest(newRepoTotals.totalInterestPaidOut)}</strong>
                        </div>
                      )}

                      {!newSymbol && (
                        <div className="warning-notice">
                          ⚠️ Symbol not generated. Please ensure all required fields are filled.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
