"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";

// Types
type Counterparty = { id: string; name: string; short_code: string };
type Portfolio = { id: string; name: string; code: string };

type CollateralPosition = {
  id: string;
  face_value: number;
  dirty_price: number;
  market_value: number;
  haircut_pct: number;
  external_custodian_ref: string | null;
};

type Allocation = {
  id: string;
  portfolio_id: string;
  principal: number;
  status: string;
  portfolios: { id: string; name: string; code: string } | null;
  collateral_positions: CollateralPosition[];
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
  created_at: string;
  securities: { id: string; symbol: string; name: string } | null;
  counterparties: { id: string; name: string; short_code: string } | null;
  repo_allocations: Allocation[];
};

// Helper functions
const formatCurrency = (value: number) => {
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const calculateInterest = (principal: number, rate: number, days: number, dayCount: number) => {
  return principal * rate * days / dayCount;
};

const getDaysBetween = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
};

const extractCleanPrice = (ref: string | null): number | null => {
  if (!ref) return null;
  const match = ref.match(/clean_price:([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
};

const calculateNCMV = (cp: CollateralPosition): number => {
  const cleanPrice = extractCleanPrice(cp.external_custodian_ref);
  const dirtyPrice = cp.dirty_price || 0;
  const nominals = cp.face_value || 0;
  const haircutPct = cp.haircut_pct || 0;
  const effectiveCleanPrice = cleanPrice || (dirtyPrice * 0.99);
  const accruedInterest = (dirtyPrice - effectiveCleanPrice) * nominals / 100;
  return (nominals * effectiveCleanPrice / 100) * haircutPct + accruedInterest;
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<RepoTrade[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [counterpartyFilter, setCounterpartyFilter] = useState<string>("all");
  const [portfolioFilter, setPortfolioFilter] = useState<string>("all");
  const [collateralFilter, setCollateralFilter] = useState<string>("all");
  const [maturityFilter, setMaturityFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("maturity_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // View mode
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setError("Please sign in");
        setLoading(false);
        return;
      }

      const { data: memberData } = await supabase
        .from("org_members")
        .select("org_id")
        .eq("user_id", authData.user.id)
        .single();

      if (!memberData) {
        setError("No organization found");
        setLoading(false);
        return;
      }

      // Load all trades with allocations and collateral
      const { data: tradesData, error: tradesError } = await supabase
        .from("repo_trades")
        .select(`
          id, repo_security_id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status, created_at,
          securities (id, symbol, name),
          counterparties (id, name, short_code),
          repo_allocations (
            id, portfolio_id, principal, status,
            portfolios (id, name, code),
            collateral_positions (
              id, face_value, dirty_price, market_value, haircut_pct, external_custodian_ref
            )
          )
        `)
        .eq("org_id", memberData.org_id)
        .order("created_at", { ascending: false });

      if (tradesError) {
        setError(tradesError.message);
        setLoading(false);
        return;
      }

      // Load counterparties
      const { data: cpData } = await supabase
        .from("counterparties")
        .select("id, name, short_code")
        .eq("org_id", memberData.org_id);

      // Load portfolios
      const { data: pfData } = await supabase
        .from("portfolios")
        .select("id, name, code")
        .eq("org_id", memberData.org_id);

      setTrades((tradesData as unknown as RepoTrade[]) || []);
      setCounterparties(cpData || []);
      setPortfolios(pfData || []);
      setLoading(false);
    };

    loadData();
  }, []);

  // Calculate trade metrics
  const getTradeMetrics = (trade: RepoTrade) => {
    const tenor = getDaysBetween(trade.issue_date, trade.maturity_date);
    const totalPrincipal = trade.repo_allocations.reduce((sum, a) => sum + a.principal, 0);
    const totalInterest = calculateInterest(totalPrincipal, trade.rate, tenor, trade.day_count_basis);
    const maturityValue = totalPrincipal + totalInterest;

    let totalNCMV = 0;
    trade.repo_allocations.forEach(alloc => {
      alloc.collateral_positions?.forEach(cp => {
        totalNCMV += calculateNCMV(cp);
      });
    });

    const hasCollateral = totalNCMV > 0;
    const collateralSufficient = totalNCMV >= maturityValue;
    const coverageRatio = maturityValue > 0 ? (totalNCMV / maturityValue) * 100 : 0;

    const today = new Date().toISOString().split("T")[0];
    const daysToMaturity = getDaysBetween(today, trade.maturity_date);

    return {
      tenor,
      totalPrincipal,
      totalInterest,
      maturityValue,
      totalNCMV,
      hasCollateral,
      collateralSufficient,
      coverageRatio,
      daysToMaturity,
      clientCount: trade.repo_allocations.length
    };
  };

  // Filtered and sorted trades
  const filteredTrades = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

    return trades
      .filter(trade => {
        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const symbol = trade.securities?.symbol?.toLowerCase() || "";
          const counterparty = trade.counterparties?.name?.toLowerCase() || "";
          if (!symbol.includes(query) && !counterparty.includes(query)) return false;
        }

        // Status filter
        if (statusFilter !== "all" && trade.status !== statusFilter) return false;

        // Counterparty filter
        if (counterpartyFilter !== "all" && trade.counterparty_id !== counterpartyFilter) return false;

        // Portfolio filter
        if (portfolioFilter !== "all") {
          const hasPortfolio = trade.repo_allocations.some(a => a.portfolio_id === portfolioFilter);
          if (!hasPortfolio) return false;
        }

        // Collateral filter
        const metrics = getTradeMetrics(trade);
        if (collateralFilter === "sufficient" && !metrics.collateralSufficient) return false;
        if (collateralFilter === "insufficient" && (metrics.collateralSufficient || !metrics.hasCollateral)) return false;
        if (collateralFilter === "none" && metrics.hasCollateral) return false;

        // Maturity filter
        if (maturityFilter === "today" && trade.maturity_date !== today) return false;
        if (maturityFilter === "tomorrow" && trade.maturity_date !== tomorrow) return false;
        if (maturityFilter === "dayafter" && trade.maturity_date !== dayAfter) return false;
        if (maturityFilter === "week" && (trade.maturity_date < today || trade.maturity_date > nextWeek)) return false;
        if (maturityFilter === "overdue" && trade.maturity_date >= today) return false;

        // Date range filter
        if (dateFrom && trade.maturity_date < dateFrom) return false;
        if (dateTo && trade.maturity_date > dateTo) return false;

        return true;
      })
      .sort((a, b) => {
        const metricsA = getTradeMetrics(a);
        const metricsB = getTradeMetrics(b);
        
        let comparison = 0;
        switch (sortBy) {
          case "maturity_date":
            comparison = a.maturity_date.localeCompare(b.maturity_date);
            break;
          case "principal":
            comparison = metricsA.totalPrincipal - metricsB.totalPrincipal;
            break;
          case "rate":
            comparison = a.rate - b.rate;
            break;
          case "coverage":
            comparison = metricsA.coverageRatio - metricsB.coverageRatio;
            break;
          case "counterparty":
            comparison = (a.counterparties?.name || "").localeCompare(b.counterparties?.name || "");
            break;
          case "created_at":
            comparison = a.created_at.localeCompare(b.created_at);
            break;
          default:
            comparison = 0;
        }
        return sortOrder === "asc" ? comparison : -comparison;
      });
  }, [trades, searchQuery, statusFilter, counterpartyFilter, portfolioFilter, collateralFilter, maturityFilter, dateFrom, dateTo, sortBy, sortOrder]);

  // Summary statistics
  const summaryStats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

    const activeTrades = trades.filter(t => ["APPROVED", "ACTIVE", "POSTED"].includes(t.status));
    
    let totalPrincipal = 0;
    let totalMaturityValue = 0;
    let totalNCMV = 0;
    let sufficientCount = 0;
    let insufficientCount = 0;
    let noCollateralCount = 0;
    let maturingToday = 0;
    let maturingTomorrow = 0;
    let maturingWeek = 0;
    let overdueCount = 0;

    const counterpartyExposure: Record<string, { name: string; principal: number; count: number }> = {};
    const portfolioExposure: Record<string, { name: string; principal: number; count: number }> = {};
    const statusCounts: Record<string, number> = {};
    const rateDistribution: { rate: number; principal: number }[] = [];

    trades.forEach(trade => {
      const metrics = getTradeMetrics(trade);
      
      // Status counts
      statusCounts[trade.status] = (statusCounts[trade.status] || 0) + 1;

      // Only count active trades for financial metrics
      if (["APPROVED", "ACTIVE", "POSTED"].includes(trade.status)) {
        totalPrincipal += metrics.totalPrincipal;
        totalMaturityValue += metrics.maturityValue;
        totalNCMV += metrics.totalNCMV;

        // Collateral status
        if (!metrics.hasCollateral) noCollateralCount++;
        else if (metrics.collateralSufficient) sufficientCount++;
        else insufficientCount++;

        // Maturity timeline
        if (trade.maturity_date === today) maturingToday++;
        else if (trade.maturity_date === tomorrow) maturingTomorrow++;
        if (trade.maturity_date >= today && trade.maturity_date <= nextWeek) maturingWeek++;
        if (trade.maturity_date < today) overdueCount++;

        // Counterparty exposure
        const cpId = trade.counterparty_id;
        if (!counterpartyExposure[cpId]) {
          counterpartyExposure[cpId] = { 
            name: trade.counterparties?.name || "Unknown", 
            principal: 0, 
            count: 0 
          };
        }
        counterpartyExposure[cpId].principal += metrics.totalPrincipal;
        counterpartyExposure[cpId].count++;

        // Portfolio exposure
        trade.repo_allocations.forEach(alloc => {
          const pfId = alloc.portfolio_id;
          if (!portfolioExposure[pfId]) {
            portfolioExposure[pfId] = { 
              name: alloc.portfolios?.name || "Unknown", 
              principal: 0, 
              count: 0 
            };
          }
          portfolioExposure[pfId].principal += alloc.principal;
          portfolioExposure[pfId].count++;
        });

        // Rate distribution
        rateDistribution.push({ rate: trade.rate * 100, principal: metrics.totalPrincipal });
      }
    });

    const avgRate = rateDistribution.length > 0 
      ? rateDistribution.reduce((sum, r) => sum + r.rate * r.principal, 0) / totalPrincipal 
      : 0;

    return {
      totalTrades: trades.length,
      activeTrades: activeTrades.length,
      totalPrincipal,
      totalMaturityValue,
      totalNCMV,
      overallCoverage: totalMaturityValue > 0 ? (totalNCMV / totalMaturityValue) * 100 : 0,
      sufficientCount,
      insufficientCount,
      noCollateralCount,
      maturingToday,
      maturingTomorrow,
      maturingWeek,
      overdueCount,
      counterpartyExposure: Object.values(counterpartyExposure).sort((a, b) => b.principal - a.principal),
      portfolioExposure: Object.values(portfolioExposure).sort((a, b) => b.principal - a.principal),
      statusCounts,
      avgRate
    };
  }, [trades]);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "DRAFT": return "status-draft";
      case "PENDING_APPROVAL": return "status-pending";
      case "APPROVED": return "status-approved";
      case "ACTIVE": return "status-active";
      case "POSTED": return "status-posted";
      case "CLOSED": return "status-closed";
      case "ROLLED": return "status-rolled";
      case "CANCELLED": return "status-cancelled";
      default: return "";
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setCounterpartyFilter("all");
    setPortfolioFilter("all");
    setCollateralFilter("all");
    setMaturityFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  if (loading) {
    return (
      <main className="dashboard-page">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading dashboard...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="dashboard-page">
        <div className="error-state">
          <p>❌ {error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      {/* Summary KPIs */}
      <section className="kpi-section">
        <div className="kpi-grid">
          <div className="kpi-card primary">
            <div className="kpi-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Total AUM</span>
              <span className="kpi-value">LKR {formatCurrency(summaryStats.totalPrincipal)}</span>
              <span className="kpi-sub">{summaryStats.activeTrades} active repos</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon maturity">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Maturity Value</span>
              <span className="kpi-value">LKR {formatCurrency(summaryStats.totalMaturityValue)}</span>
              <span className="kpi-sub">Avg. {summaryStats.avgRate.toFixed(2)}% rate</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon collateral">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Total NCMV</span>
              <span className="kpi-value">LKR {formatCurrency(summaryStats.totalNCMV)}</span>
              <span className={`kpi-sub ${summaryStats.overallCoverage >= 100 ? "positive" : "negative"}`}>
                {summaryStats.overallCoverage.toFixed(1)}% coverage
              </span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon warning">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Attention Required</span>
              <span className="kpi-value">{summaryStats.insufficientCount + summaryStats.noCollateralCount}</span>
              <span className="kpi-sub">{summaryStats.insufficientCount} insufficient, {summaryStats.noCollateralCount} no collateral</span>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Stats Row */}
      <section className="quick-stats-section">
        <div className="quick-stats-grid">
          <div className="quick-stat today" onClick={() => setMaturityFilter("today")}>
            <span className="stat-number">{summaryStats.maturingToday}</span>
            <span className="stat-label">Maturing Today</span>
          </div>
          <div className="quick-stat tomorrow" onClick={() => setMaturityFilter("tomorrow")}>
            <span className="stat-number">{summaryStats.maturingTomorrow}</span>
            <span className="stat-label">Tomorrow</span>
          </div>
          <div className="quick-stat week" onClick={() => setMaturityFilter("week")}>
            <span className="stat-number">{summaryStats.maturingWeek}</span>
            <span className="stat-label">This Week</span>
          </div>
          {summaryStats.overdueCount > 0 && (
            <div className="quick-stat overdue" onClick={() => setMaturityFilter("overdue")}>
              <span className="stat-number">{summaryStats.overdueCount}</span>
              <span className="stat-label">Overdue</span>
            </div>
          )}
          <div className="quick-stat sufficient" onClick={() => setCollateralFilter("sufficient")}>
            <span className="stat-number">{summaryStats.sufficientCount}</span>
            <span className="stat-label">Collateral OK</span>
          </div>
          <div className="quick-stat insufficient" onClick={() => setCollateralFilter("insufficient")}>
            <span className="stat-number">{summaryStats.insufficientCount}</span>
            <span className="stat-label">Insufficient</span>
          </div>
        </div>
      </section>

      {/* Analytics Row */}
      <section className="analytics-section">
        <div className="analytics-grid">
          {/* Counterparty Exposure */}
          <div className="analytics-card">
            <h3>Counterparty Exposure</h3>
            <div className="exposure-list">
              {summaryStats.counterpartyExposure.slice(0, 5).map((cp, idx) => (
                <div key={idx} className="exposure-item">
                  <div className="exposure-info">
                    <span className="exposure-name">{cp.name}</span>
                    <span className="exposure-count">{cp.count} repos</span>
                  </div>
                  <div className="exposure-bar-container">
                    <div 
                      className="exposure-bar" 
                      style={{ 
                        width: `${(cp.principal / summaryStats.totalPrincipal) * 100}%` 
                      }}
                    />
                  </div>
                  <span className="exposure-value">LKR {formatCurrency(cp.principal)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Portfolio Distribution */}
          <div className="analytics-card">
            <h3>Client Distribution</h3>
            <div className="exposure-list">
              {summaryStats.portfolioExposure.slice(0, 5).map((pf, idx) => (
                <div key={idx} className="exposure-item">
                  <div className="exposure-info">
                    <span className="exposure-name">{pf.name}</span>
                    <span className="exposure-count">{pf.count} allocations</span>
                  </div>
                  <div className="exposure-bar-container portfolio">
                    <div 
                      className="exposure-bar" 
                      style={{ 
                        width: `${(pf.principal / summaryStats.totalPrincipal) * 100}%` 
                      }}
                    />
                  </div>
                  <span className="exposure-value">LKR {formatCurrency(pf.principal)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Status Distribution */}
          <div className="analytics-card">
            <h3>Status Distribution</h3>
            <div className="status-distribution">
              {Object.entries(summaryStats.statusCounts).map(([status, count]) => (
                <div 
                  key={status} 
                  className={`status-chip ${getStatusBadgeClass(status)}`}
                  onClick={() => setStatusFilter(status)}
                >
                  <span className="status-name">{status.replace("_", " ")}</span>
                  <span className="status-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="filters-section">
        <div className="filters-row">
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Status</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="ACTIVE">Active</option>
            <option value="POSTED">Posted</option>
            <option value="CLOSED">Closed</option>
            <option value="ROLLED">Rolled</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <select value={counterpartyFilter} onChange={(e) => setCounterpartyFilter(e.target.value)}>
            <option value="all">Counterparty</option>
            {counterparties.map(cp => (
              <option key={cp.id} value={cp.id}>{cp.short_code}</option>
            ))}
          </select>

          <select value={portfolioFilter} onChange={(e) => setPortfolioFilter(e.target.value)}>
            <option value="all">Client</option>
            {portfolios.map(pf => (
              <option key={pf.id} value={pf.id}>{pf.code}</option>
            ))}
          </select>

          <select value={collateralFilter} onChange={(e) => setCollateralFilter(e.target.value)}>
            <option value="all">Collateral</option>
            <option value="sufficient">Sufficient</option>
            <option value="insufficient">Insufficient</option>
            <option value="none">None</option>
          </select>

          <select value={maturityFilter} onChange={(e) => setMaturityFilter(e.target.value)}>
            <option value="all">Maturity</option>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="dayafter">Day After</option>
            <option value="week">This Week</option>
            <option value="overdue">Overdue</option>
          </select>

          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="maturity_date">Sort: Maturity</option>
            <option value="principal">Sort: Principal</option>
            <option value="rate">Sort: Rate</option>
            <option value="coverage">Sort: Coverage</option>
            <option value="counterparty">Sort: Counterparty</option>
            <option value="created_at">Sort: Created</option>
          </select>

          <button 
            className="sort-order-btn"
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            title={sortOrder === "asc" ? "Ascending" : "Descending"}
          >
            {sortOrder === "asc" ? "↑" : "↓"}
          </button>

          <div className="view-toggle">
            <button 
              className={viewMode === "cards" ? "active" : ""} 
              onClick={() => setViewMode("cards")}
              title="Card View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
            </button>
            <button 
              className={viewMode === "table" ? "active" : ""} 
              onClick={() => setViewMode("table")}
              title="Table View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
          </div>

          <button className="clear-filters-btn" onClick={clearFilters}>
            Clear
          </button>
        </div>
      </section>

      {/* Results Count */}
      <div className="results-count">
        Showing {filteredTrades.length} of {trades.length} repos
      </div>

      {/* Trade List */}
      {viewMode === "cards" ? (
        <section className="trades-grid">
          {filteredTrades.map(trade => {
            const metrics = getTradeMetrics(trade);
            return (
              <div key={trade.id} className="trade-card-dashboard">
                <div className="trade-card-header">
                  <div className="trade-symbol">{trade.securities?.symbol || "N/A"}</div>
                  <span className={`status-badge ${getStatusBadgeClass(trade.status)}`}>
                    {trade.status.replace("_", " ")}
                  </span>
                </div>

                <div className="trade-card-body">
                  <div className="trade-counterparty">{trade.counterparties?.name || "Unknown"}</div>
                  
                  <div className="trade-details-grid">
                    <div className="detail">
                      <span className="label">Principal</span>
                      <span className="value">LKR {formatCurrency(metrics.totalPrincipal)}</span>
                    </div>
                    <div className="detail">
                      <span className="label">Rate</span>
                      <span className="value">{(trade.rate * 100).toFixed(2)}%</span>
                    </div>
                    <div className="detail">
                      <span className="label">Tenor</span>
                      <span className="value">{metrics.tenor} days</span>
                    </div>
                    <div className="detail">
                      <span className="label">Clients</span>
                      <span className="value">{metrics.clientCount}</span>
                    </div>
                  </div>

                  <div className="trade-dates">
                    <span>{formatDate(trade.issue_date)}</span>
                    <span>→</span>
                    <span className={metrics.daysToMaturity <= 1 ? "urgent" : ""}>
                      {formatDate(trade.maturity_date)}
                      {metrics.daysToMaturity === 0 && " (Today)"}
                      {metrics.daysToMaturity === 1 && " (Tomorrow)"}
                      {metrics.daysToMaturity < 0 && " (Overdue)"}
                    </span>
                  </div>

                  <div className="trade-maturity">
                    <span className="label">Maturity Value</span>
                    <span className="value highlight">LKR {formatCurrency(metrics.maturityValue)}</span>
                  </div>

                  <div className={`trade-collateral ${metrics.collateralSufficient ? "sufficient" : metrics.hasCollateral ? "insufficient" : "none"}`}>
                    <div className="collateral-info">
                      <span className="label">NCMV</span>
                      <span className="value">LKR {formatCurrency(metrics.totalNCMV)}</span>
                    </div>
                    <div className="coverage-badge">
                      {metrics.hasCollateral 
                        ? `${metrics.coverageRatio.toFixed(0)}%`
                        : "No Collateral"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="trades-table-section">
          <table className="trades-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Counterparty</th>
                <th>Status</th>
                <th>Principal</th>
                <th>Rate</th>
                <th>Tenor</th>
                <th>Maturity</th>
                <th>Maturity Value</th>
                <th>NCMV</th>
                <th>Coverage</th>
                <th>Clients</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map(trade => {
                const metrics = getTradeMetrics(trade);
                return (
                  <tr key={trade.id} className={metrics.daysToMaturity <= 1 ? "urgent-row" : ""}>
                    <td className="symbol-cell">{trade.securities?.symbol || "N/A"}</td>
                    <td>{trade.counterparties?.name || "Unknown"}</td>
                    <td>
                      <span className={`status-badge-small ${getStatusBadgeClass(trade.status)}`}>
                        {trade.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="number">LKR {formatCurrency(metrics.totalPrincipal)}</td>
                    <td className="number">{(trade.rate * 100).toFixed(2)}%</td>
                    <td className="number">{metrics.tenor}d</td>
                    <td className={metrics.daysToMaturity <= 1 ? "urgent" : ""}>
                      {formatDate(trade.maturity_date)}
                    </td>
                    <td className="number highlight">LKR {formatCurrency(metrics.maturityValue)}</td>
                    <td className="number">{formatCurrency(metrics.totalNCMV)}</td>
                    <td className={`coverage ${metrics.collateralSufficient ? "ok" : metrics.hasCollateral ? "warning" : "none"}`}>
                      {metrics.hasCollateral ? `${metrics.coverageRatio.toFixed(0)}%` : "-"}
                    </td>
                    <td className="number">{metrics.clientCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {filteredTrades.length === 0 && (
        <div className="empty-state">
          <p>No repos match your filters.</p>
          <button onClick={clearFilters}>Clear all filters</button>
        </div>
      )}
    </main>
  );
}
