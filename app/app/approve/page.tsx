"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";

type CollateralPosition = {
  id: string;
  collateral_security_id: string;
  face_value: number;
  dirty_price: number | null;
  market_value: number;
  haircut_pct: number;
  valuation_date: string;
  status: string;
  external_custodian_ref: string | null;
  securities: { symbol: string | null; name: string | null } | null;
};

type Allocation = {
  id: string;
  principal: number;
  portfolio: { name: string } | null;
  cash_account: { bank_name: string; account_no: string } | null;
  custody_account: { provider: string; account_no: string } | null;
  collateral_positions: CollateralPosition[];
};

type RepoTrade = {
  id: string;
  status: string;
  issue_date: string;
  maturity_date: string;
  rate: number;
  day_count_basis: number;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  counterparty: { name: string } | null;
  repo_security: { symbol: string; name: string } | null;
  allocations: Allocation[];
};

type UserRole = "FO_TRADER" | "BO_OPERATIONS" | "RISK_COMPLIANCE" | "OPS_SUPERVISOR" | "READ_ONLY";

type TabType = "pending" | "approved";

export default function ApprovePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<RepoTrade[]>([]);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set());
  const [expandedCollateral, setExpandedCollateral] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabType>("pending");

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      // Get current user
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to access this page.");
        setLoading(false);
        return;
      }

      setUserEmail(authData.user.email || "");
      setUserId(authData.user.id);

      // Get user role
      const { data: memberData, error: memberError } = await supabase
        .from("org_members")
        .select("role, org_id")
        .eq("user_id", authData.user.id)
        .single();

      if (memberError || !memberData) {
        setError("No organization membership found.");
        setLoading(false);
        return;
      }

      setUserRole(memberData.role as UserRole);

      // Load trades with allocations and collateral
      const { data: tradesData, error: tradesError } = await supabase
        .from("repo_trades")
        .select(`
          id, status, issue_date, maturity_date, rate, day_count_basis, notes, created_at, created_by,
          counterparty:counterparties(name),
          repo_security:securities(symbol, name),
          allocations:repo_allocations(
            id, principal,
            portfolio:portfolios(name),
            cash_account:cash_accounts(bank_name, account_no),
            custody_account:custody_accounts(provider, account_no),
            collateral_positions(
              id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref,
              securities(symbol, name)
            )
          )
        `)
        .eq("org_id", memberData.org_id)
        .in("status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED"])
        .order("created_at", { ascending: false });

      if (tradesError) {
        setError(tradesError.message);
        setLoading(false);
        return;
      }

      setTrades((tradesData as unknown as RepoTrade[]) || []);
      setLoading(false);
    };

    init();
  }, []);

  const toggleExpanded = (tradeId: string) => {
    setExpandedTrades((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };

  const toggleCollateralExpanded = (tradeId: string) => {
    setExpandedCollateral((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };

  // TODO: Remove FO_TRADER from approval roles in production
  const hasApproveRole = userRole === "BO_OPERATIONS" || userRole === "OPS_SUPERVISOR" || userRole === "FO_TRADER";
  
  // Check if user can approve a specific trade (can't approve own trades)
  const canApproveTrade = (trade: RepoTrade) => {
    if (!hasApproveRole) return false;
    if (trade.created_by === userId) return false; // Can't approve own trades
    return true;
  };
  
  const isOwnTrade = (trade: RepoTrade) => trade.created_by === userId;

  // Calculate tenor in days
  const calculateTenor = (issueDate: string, maturityDate: string) => {
    const issue = new Date(issueDate);
    const maturity = new Date(maturityDate);
    const diff = maturity.getTime() - issue.getTime();
    return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
  };

  // Calculate interest for a principal amount
  const calculateInterest = (principal: number, rate: number, tenor: number, dayCount: number) => {
    if (!tenor || !rate || !dayCount || !principal) return 0;
    return principal * rate * (tenor / dayCount);
  };

  // Calculate totals for a trade
  const calculateTradeTotals = (trade: RepoTrade) => {
    const tenor = calculateTenor(trade.issue_date, trade.maturity_date);
    const totalPrincipal = trade.allocations?.reduce((sum, a) => sum + (a.principal || 0), 0) || 0;
    const totalInterest = calculateInterest(totalPrincipal, trade.rate, tenor, trade.day_count_basis);
    const maturityValue = totalPrincipal + totalInterest;
    return { tenor, totalPrincipal, totalInterest, maturityValue };
  };

  // Extract clean price from external_custodian_ref (format: "...|cp:102.3" or "cp:102.3")
  const extractCleanPrice = (ref: string | null): number | null => {
    if (!ref) return null;
    const match = ref.match(/cp:(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : null;
  };

  // Calculate collateral value for a trade using NCMV formula
  const calculateCollateralValue = (trade: RepoTrade) => {
    let totalMarketValue = 0;
    let totalNcmv = 0;

    trade.allocations?.forEach((alloc) => {
      alloc.collateral_positions?.forEach((cp) => {
        if (cp.status === "RECEIVED" || cp.status === "ACTIVE") {
          totalMarketValue += cp.market_value || 0;
          
          // Calculate NCMV using same formula as Collateral page
          const cleanPrice = extractCleanPrice(cp.external_custodian_ref);
          const dirtyPrice = cp.dirty_price || 0;
          const nominals = cp.face_value || 0;
          const haircutPct = cp.haircut_pct || 0;
          
          // If no clean price stored, estimate from dirty price
          const effectiveCleanPrice = cleanPrice || (dirtyPrice * 0.99);
          
          // Accrued Interest = (Dirty Price - Clean Price) × Nominals / 100
          const accruedInterest = (dirtyPrice - effectiveCleanPrice) * nominals / 100;
          
          // NCMV = (Nominals × Clean Price / 100) × Haircut + Accrued Interest
          const ncmv = (nominals * effectiveCleanPrice / 100) * haircutPct + accruedInterest;
          
          totalNcmv += ncmv;
        }
      });
    });

    return { totalMarketValue, totalHaircutValue: totalNcmv };
  };

  // Check if trade can be approved (collateral value after haircut >= maturity value)
  const canApproveCollateral = (trade: RepoTrade) => {
    const { maturityValue } = calculateTradeTotals(trade);
    const { totalHaircutValue } = calculateCollateralValue(trade);
    return totalHaircutValue >= maturityValue;
  };

  // Filter trades by tab
  const pendingTrades = useMemo(() => 
    trades.filter(t => t.status === "DRAFT" || t.status === "PENDING_APPROVAL"),
    [trades]
  );

  const approvedTrades = useMemo(() => 
    trades.filter(t => t.status === "APPROVED" || t.status === "POSTED"),
    [trades]
  );

  const handleApprove = async (tradeId: string) => {
    if (!hasApproveRole) return;
    
    const trade = trades.find(t => t.id === tradeId);
    if (!trade) return;

    // Check collateral requirement
    if (!canApproveCollateral(trade)) {
      alert("Cannot approve: Collateral value (after haircut) must be greater than or equal to maturity value. Please attach sufficient collateral first.");
      return;
    }

    setProcessing(tradeId);

    // Update trade status
    const { error: tradeError } = await supabase
      .from("repo_trades")
      .update({ status: "APPROVED", approved_at: new Date().toISOString() })
      .eq("id", tradeId);

    if (tradeError) {
      alert("Error approving trade: " + tradeError.message);
      setProcessing(null);
      return;
    }

    // Also update allocation statuses
    const { error: allocError } = await supabase
      .from("repo_allocations")
      .update({ status: "APPROVED" })
      .eq("repo_trade_id", tradeId);

    if (allocError) {
      console.error("Error updating allocations:", allocError.message);
    }

    setTrades((prev) =>
      prev.map((t) => (t.id === tradeId ? { ...t, status: "APPROVED" } : t))
    );
    setProcessing(null);
  };

  const handlePost = async (tradeId: string) => {
    if (!hasApproveRole) return;
    setProcessing(tradeId);

    const { error: tradeError } = await supabase
      .from("repo_trades")
      .update({ status: "POSTED", posted_at: new Date().toISOString() })
      .eq("id", tradeId);

    if (tradeError) {
      alert("Error posting: " + tradeError.message);
      setProcessing(null);
      return;
    }

    // Also update allocation statuses
    const { error: allocError } = await supabase
      .from("repo_allocations")
      .update({ status: "POSTED" })
      .eq("repo_trade_id", tradeId);

    if (allocError) {
      console.error("Error updating allocations:", allocError.message);
    }

    setTrades((prev) =>
      prev.map((t) => (t.id === tradeId ? { ...t, status: "POSTED" } : t))
    );
    setProcessing(null);
  };

  const handleReject = async (tradeId: string) => {
    if (!hasApproveRole) return;
    setProcessing(tradeId);

    const { error } = await supabase
      .from("repo_trades")
      .update({ status: "CANCELLED" })
      .eq("id", tradeId);

    if (error) {
      alert("Error rejecting: " + error.message);
    } else {
      setTrades((prev) => prev.filter((t) => t.id !== tradeId));
    }
    setProcessing(null);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: "badge-draft",
      PENDING_APPROVAL: "badge-pending",
      APPROVED: "badge-approved",
      POSTED: "badge-posted",
    };
    return colors[status] || "";
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const formatRate = (rate: number) => {
    return (rate * 100).toFixed(2) + "%";
  };

  const formatCurrency = (amount: number) => {
    return "LKR " + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getDayCountLabel = (basis: number) => {
    return basis === 365 ? "ACT/365" : basis === 360 ? "ACT/360" : String(basis);
  };

  const formatPct = (value: number) => {
    return (value * 100).toFixed(2) + "%";
  };

  if (loading) {
    return (
      <main>
        <section>
          <h2>Loading...</h2>
          <p>Fetching repo trades for approval.</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main>
        <section>
          <h2>Error</h2>
          <p>{error}</p>
          <a href="/" className="back-link">← Back to Entry</a>
        </section>
      </main>
    );
  }

  const renderTradeCard = (trade: RepoTrade) => {
    const isExpanded = expandedTrades.has(trade.id);
    const isCollateralExpanded = expandedCollateral.has(trade.id);
    const totals = calculateTradeTotals(trade);
    const tenor = calculateTenor(trade.issue_date, trade.maturity_date);
    const collateralValues = calculateCollateralValue(trade);
    const hasCollateral = collateralValues.totalMarketValue > 0;
    const collateralSufficient = canApproveCollateral(trade);
    const isPending = trade.status === "DRAFT" || trade.status === "PENDING_APPROVAL";
    
    return (
      <div key={trade.id} className={`trade-card ${isExpanded ? "expanded" : ""}`}>
        {/* Collapsed Header - Always Visible */}
        <div 
          className="trade-header clickable"
          onClick={() => toggleExpanded(trade.id)}
        >
          <div className="trade-header-left">
            <span className={`badge ${getStatusBadge(trade.status)}`}>
              {trade.status}
            </span>
            <span className="trade-symbol">{trade.repo_security?.symbol || "N/A"}</span>
            <span className="trade-counterparty">{trade.counterparty?.name}</span>
          </div>
          <div className="trade-header-right">
            <span className="trade-principal">{formatCurrency(totals.totalPrincipal)}</span>
            <span className="trade-rate">{formatRate(trade.rate)}</span>
            <span className="trade-expand-icon">{isExpanded ? "▼" : "▶"}</span>
          </div>
        </div>

        {/* Summary Row - Always Visible */}
        <div className="trade-summary-row">
          <div className="summary-chip">
            <span className="chip-label">Issue</span>
            <span className="chip-value">{formatDate(trade.issue_date)}</span>
          </div>
          <div className="summary-chip">
            <span className="chip-label">Maturity</span>
            <span className="chip-value">{formatDate(trade.maturity_date)}</span>
          </div>
          <div className="summary-chip">
            <span className="chip-label">Tenor</span>
            <span className="chip-value">{tenor} days</span>
          </div>
          <div className="summary-chip highlight">
            <span className="chip-label">Maturity Value</span>
            <span className="chip-value">{formatCurrency(totals.maturityValue)}</span>
          </div>
          {isPending && (
            <div className={`summary-chip ${collateralSufficient ? "collateral-ok" : "collateral-short"}`}>
              <span className="chip-label">NCMV</span>
              <span className="chip-value">{formatCurrency(collateralValues.totalHaircutValue)}</span>
            </div>
          )}
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="trade-expanded-details">
            {/* Trade Details */}
            <div className="trade-details-grid">
              <div className="detail-item">
                <label>Security Name</label>
                <span>{trade.repo_security?.name || "N/A"}</span>
              </div>
              <div className="detail-item">
                <label>Day Count Convention</label>
                <span>{getDayCountLabel(trade.day_count_basis)}</span>
              </div>
              <div className="detail-item">
                <label>Total Interest</label>
                <span className="interest-value">{formatCurrency(totals.totalInterest)}</span>
              </div>
              <div className="detail-item">
                <label>Created</label>
                <span>{formatDate(trade.created_at)}</span>
              </div>
              {trade.notes && (
                <div className="detail-item full-width">
                  <label>Notes</label>
                  <span>{trade.notes}</span>
                </div>
              )}
            </div>

            {/* Client Allocations */}
            <div className="allocations-section">
              <h4>Client Allocations ({trade.allocations?.length || 0})</h4>
              <table className="allocations-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Principal</th>
                    <th>Interest</th>
                    <th>Maturity Value</th>
                    <th>Cash Account</th>
                    <th>Custody Account</th>
                  </tr>
                </thead>
                <tbody>
                  {trade.allocations?.map((alloc) => {
                    const allocInterest = calculateInterest(
                      alloc.principal, 
                      trade.rate, 
                      tenor, 
                      trade.day_count_basis
                    );
                    const allocMaturity = alloc.principal + allocInterest;
                    
                    return (
                      <tr key={alloc.id}>
                        <td>{alloc.portfolio?.name || "N/A"}</td>
                        <td>{formatCurrency(alloc.principal)}</td>
                        <td className="interest-cell">{formatCurrency(allocInterest)}</td>
                        <td className="maturity-cell">{formatCurrency(allocMaturity)}</td>
                        <td>
                          {alloc.cash_account 
                            ? `${alloc.cash_account.bank_name} - ${alloc.cash_account.account_no}`
                            : "-"}
                        </td>
                        <td>
                          {alloc.custody_account
                            ? `${alloc.custody_account.provider} - ${alloc.custody_account.account_no}`
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>Total</strong></td>
                    <td><strong>{formatCurrency(totals.totalPrincipal)}</strong></td>
                    <td className="interest-cell"><strong>{formatCurrency(totals.totalInterest)}</strong></td>
                    <td className="maturity-cell"><strong>{formatCurrency(totals.maturityValue)}</strong></td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Collateral Section - Expandable */}
            <div className="collateral-section">
              <div 
                className="collateral-header clickable"
                onClick={() => toggleCollateralExpanded(trade.id)}
              >
                <h4>
                  Collateral {hasCollateral ? `(${collateralSufficient ? "✓ Sufficient" : "⚠️ Insufficient"})` : "(None attached)"}
                </h4>
                <span className="expand-icon">{isCollateralExpanded ? "▼" : "▶"}</span>
              </div>
              
              {isCollateralExpanded && (
                <div className="collateral-content">
                  {/* Collateral Summary */}
                  <div className="collateral-summary">
                    <div className="collateral-summary-item">
                      <label>Total Collateral Value</label>
                      <span>{formatCurrency(collateralValues.totalMarketValue)}</span>
                    </div>
                    <div className="collateral-summary-item">
                      <label>Total NCMV</label>
                      <span className={collateralSufficient ? "value-ok" : "value-short"}>
                        {formatCurrency(collateralValues.totalHaircutValue)}
                      </span>
                    </div>
                    <div className="collateral-summary-item">
                      <label>Required (Maturity Value)</label>
                      <span>{formatCurrency(totals.maturityValue)}</span>
                    </div>
                    <div className="collateral-summary-item">
                      <label>Coverage Ratio</label>
                      <span className={collateralSufficient ? "value-ok" : "value-short"}>
                        {totals.maturityValue > 0 
                          ? ((collateralValues.totalHaircutValue / totals.maturityValue) * 100).toFixed(1) + "%"
                          : "-"}
                      </span>
                    </div>
                  </div>

                  {/* Collateral Positions Table */}
                  {hasCollateral ? (
                    <table className="collateral-table">
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Security</th>
                          <th>Nominals</th>
                          <th>Clean Price</th>
                          <th>Dirty Price</th>
                          <th>Accrued Int.</th>
                          <th>Coll. Value</th>
                          <th>Haircut %</th>
                          <th>NCMV</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trade.allocations?.flatMap((alloc) =>
                          alloc.collateral_positions?.map((cp) => {
                            const cleanPrice = extractCleanPrice(cp.external_custodian_ref);
                            const dirtyPrice = cp.dirty_price || 0;
                            const nominals = cp.face_value || 0;
                            const haircutPct = cp.haircut_pct || 0;
                            const effectiveCleanPrice = cleanPrice || (dirtyPrice * 0.99);
                            const accruedInterest = (dirtyPrice - effectiveCleanPrice) * nominals / 100;
                            const collateralValue = dirtyPrice * nominals / 100 + accruedInterest;
                            const ncmv = (nominals * effectiveCleanPrice / 100) * haircutPct + accruedInterest;
                            
                            return (
                              <tr key={cp.id}>
                                <td>{alloc.portfolio?.name || "N/A"}</td>
                                <td>{cp.securities?.symbol || "N/A"}</td>
                                <td>{nominals.toLocaleString()}</td>
                                <td>{effectiveCleanPrice.toFixed(4)}</td>
                                <td>{dirtyPrice.toFixed(4)}</td>
                                <td>{accruedInterest.toFixed(2)}</td>
                                <td>{formatCurrency(collateralValue)}</td>
                                <td>{(haircutPct * 100).toFixed(2)}%</td>
                                <td className="haircut-value">
                                  {formatCurrency(ncmv)}
                                </td>
                                <td>
                                  <span className={`status-badge status-${cp.status.toLowerCase()}`}>
                                    {cp.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          }) || []
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <div className="no-collateral-message">
                      <p>No collateral attached to this trade.</p>
                      <a href={`/collateral`} className="attach-collateral-link">
                        → Go to Collateral page to attach
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="trade-actions">
          {isPending && (
            <>
              {canApproveTrade(trade) ? (
                <>
                  <button
                    className={`primary ${!collateralSufficient ? "disabled-approval" : ""}`}
                    onClick={() => handleApprove(trade.id)}
                    disabled={processing === trade.id || !collateralSufficient}
                    title={!collateralSufficient ? "Insufficient collateral" : ""}
                  >
                    {processing === trade.id ? "Processing..." : "Approve"}
                  </button>
                  {!collateralSufficient && (
                    <span className="collateral-warning">⚠️ Insufficient collateral</span>
                  )}
                  <button
                    className="ghost"
                    onClick={() => handleReject(trade.id)}
                    disabled={processing === trade.id}
                  >
                    Reject
                  </button>
                </>
              ) : isOwnTrade(trade) ? (
                <span className="self-trade-notice">⚠️ You cannot approve your own trade</span>
              ) : !hasApproveRole ? (
                <span className="no-permission-notice">View only - no approval permission</span>
              ) : null}
            </>
          )}
          {trade.status === "APPROVED" && (
            canApproveTrade(trade) ? (
              <button
                className="primary"
                onClick={() => handlePost(trade.id)}
                disabled={processing === trade.id}
              >
                {processing === trade.id ? "Processing..." : "Post to System"}
              </button>
            ) : (
              <span className="approved-label">✓ Approved - awaiting posting</span>
            )
          )}
          {trade.status === "POSTED" && (
            <span className="posted-label">✓ Posted to System</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <main>
      <header className="page-header">
        <div>
          <div className={`badge ${hasApproveRole ? "badge-bo" : ""}`}>
            {hasApproveRole ? "BO Operations" : "View Only"} • {userEmail}
          </div>
          <h1>Repo Trade Approvals</h1>
          <p>Review, approve, and post repo trades submitted by Front Office.</p>
        </div>
      </header>

      {!hasApproveRole && (
        <section className="info-banner">
          <p>👁️ You are viewing as <strong>{userRole}</strong>. Only BO_OPERATIONS or OPS_SUPERVISOR can approve trades.</p>
        </section>
      )}
      
      {hasApproveRole && (
        <section className="info-banner success-banner">
          <p>✅ You have <strong>{userRole}</strong> permissions. You can approve trades created by other users. {userRole === "FO_TRADER" && "(Dev mode: FO_TRADER has temp approval rights)"}</p>
        </section>
      )}

      {/* Tabs */}
      <div className="tabs-container">
        <button
          className={`tab-button ${activeTab === "pending" ? "active" : ""}`}
          onClick={() => setActiveTab("pending")}
        >
          Pending Approval ({pendingTrades.length})
        </button>
        <button
          className={`tab-button ${activeTab === "approved" ? "active" : ""}`}
          onClick={() => setActiveTab("approved")}
        >
          Approved ({approvedTrades.length})
        </button>
      </div>

      <section>
        {activeTab === "pending" && (
          <>
            <h2>Pending Approval ({pendingTrades.length})</h2>
            {pendingTrades.length === 0 ? (
              <p className="empty-state">No trades pending approval. Submit a repo from the New Repo page first.</p>
            ) : (
              <div className="trades-list">
                {pendingTrades.map(renderTradeCard)}
              </div>
            )}
          </>
        )}

        {activeTab === "approved" && (
          <>
            <h2>Approved Trades ({approvedTrades.length})</h2>
            {approvedTrades.length === 0 ? (
              <p className="empty-state">No approved trades yet.</p>
            ) : (
              <div className="trades-list">
                {approvedTrades.map(renderTradeCard)}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
