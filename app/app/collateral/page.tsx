"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrgOption = { id: string; name: string };
type Portfolio = { id: string; name: string };
type Counterparty = { id: string; name: string };
type Security = { id: string; symbol: string; name: string | null };

type CollateralPosition = {
  id: string;
  repo_allocation_id: string;
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

type RepoAllocation = {
  id: string;
  portfolio_id: string;
  principal: number;
  portfolios: { name: string } | null;
};

type RepoTradeWithDetails = {
  id: string;
  status: string;
  issue_date: string;
  maturity_date: string;
  rate: number;
  day_count_basis: number;
  notes: string | null;
  created_at: string;
  securities: { symbol: string; name: string | null } | null;
  counterparties: { name: string } | null;
  repo_allocations: RepoAllocation[];
};

// Collateral entry for inline form
type CollateralEntry = {
  id: string;
  securityId: string;
  nominals: string;
  cleanPrice: string;
  dirtyPrice: string;
  haircutPct: string;
  valuationDate: string;
  externalRef: string;
};

type TabType = "attach" | "substitute" | "monitor";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 }).format(value);

const formatPct = (value: number) => (value * 100).toFixed(2) + "%";

// Calculate collateral values
const calculateCollateralValues = (entry: CollateralEntry) => {
  const nominals = Number(entry.nominals) || 0;
  const cleanPrice = Number(entry.cleanPrice) || 0;
  const dirtyPrice = Number(entry.dirtyPrice) || 0;
  const haircutPct = (Number(entry.haircutPct) || 0) / 100;

  // Accrued Interest = (Dirty Price - Clean Price) × Nominals / 100
  const accruedInterest = (dirtyPrice - cleanPrice) * nominals / 100;
  
  // Collateral Value = Dirty Price × Nominals / 100 + Accrued Interest
  const collateralValue = (dirtyPrice * nominals / 100) + accruedInterest;
  
  // NCMV = (Clean Price × Haircut + Accrued Interest per 100) × Nominals / 100
  const ncmv = (cleanPrice * haircutPct + (dirtyPrice - cleanPrice)) * nominals / 100;

  return { collateralValue, accruedInterest, ncmv };
};

const generateId = () => Math.random().toString(36).substring(2, 9);

export default function CollateralPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [collateralSecurities, setCollateralSecurities] = useState<Security[]>([]);
  const [collateralPositions, setCollateralPositions] = useState<CollateralPosition[]>([]);
  const [repoTrades, setRepoTrades] = useState<RepoTradeWithDetails[]>([]);

  const [activeTab, setActiveTab] = useState<TabType>("attach");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterCounterparty, setFilterCounterparty] = useState<string>("");
  const [filterPortfolio, setFilterPortfolio] = useState<string>("");
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set());
  
  // Track which trades have collateral entry form open
  const [attachingToTrade, setAttachingToTrade] = useState<string | null>(null);
  
  // Collateral entries being added (multiple per trade)
  const [collateralEntries, setCollateralEntries] = useState<CollateralEntry[]>([]);

  // Inline substitution state - track which position is being substituted
  const [substitutingPositionId, setSubstitutingPositionId] = useState<string | null>(null);
  const [subEntry, setSubEntry] = useState<CollateralEntry>({
    id: "",
    securityId: "",
    nominals: "",
    cleanPrice: "",
    dirtyPrice: "",
    haircutPct: "0",
    valuationDate: new Date().toISOString().slice(0, 10),
    externalRef: ""
  });
  const [subReason, setSubReason] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to manage collateral.");
        setLoading(false);
        return;
      }
      setUserId(authData.user.id);

      const { data: memberData, error: memberError } = await supabase
        .from("org_members")
        .select("org_id, orgs ( id, name )")
        .eq("user_id", authData.user.id);

      if (memberError) {
        setError(memberError.message);
        setLoading(false);
        return;
      }

      const orgs: OrgOption[] =
        (memberData as Array<{ org_id: string; orgs?: { id?: string; name?: string } | null }>)
          ?.map((row) => ({
            id: row.org_id,
            name: row.orgs?.name ?? row.org_id
          }))
          .filter((row) => Boolean(row.id)) ?? [];

      if (!orgs.length) {
        setError("No organization membership found.");
        setLoading(false);
        return;
      }

      setOrgOptions(orgs);
      setOrgId(orgs[0].id);
      setLoading(false);
    };

    init();
  }, []);

  const refreshData = async (targetOrgId: string) => {
    if (!targetOrgId) return;
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    const [
      portfolioRes,
      counterpartyRes,
      securitiesRes,
      collateralRes,
      repoTradesRes
    ] = await Promise.all([
      supabase.from("portfolios").select("id, name").eq("org_id", targetOrgId),
      supabase.from("counterparties").select("id, name").eq("org_id", targetOrgId),
      supabase
        .from("securities")
        .select("id, symbol, name, security_types!inner ( is_repo_type )")
        .eq("org_id", targetOrgId)
        .eq("security_types.is_repo_type", false),
      supabase
        .from("collateral_positions")
        .select(
          "id, repo_allocation_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref, securities ( symbol, name )"
        )
        .eq("org_id", targetOrgId),
      supabase
        .from("repo_trades")
        .select(
          "id, status, issue_date, maturity_date, rate, day_count_basis, notes, created_at, securities ( symbol, name ), counterparties ( name ), repo_allocations ( id, portfolio_id, principal, portfolios ( name ) )"
        )
        .eq("org_id", targetOrgId)
        .in("status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "ACTIVE"])
        .order("created_at", { ascending: false })
    ]);

    if (portfolioRes.error || counterpartyRes.error || securitiesRes.error || collateralRes.error || repoTradesRes.error) {
      setError(
        portfolioRes.error?.message ||
          counterpartyRes.error?.message ||
          securitiesRes.error?.message ||
          collateralRes.error?.message ||
        repoTradesRes.error?.message ||
        "Failed to load data."
      );
      setLoading(false);
      return;
    }

    setPortfolios((portfolioRes.data as Portfolio[]) ?? []);
    setCounterparties((counterpartyRes.data as Counterparty[]) ?? []);
    const securitiesData = securitiesRes.data ?? [];
    setCollateralSecurities(
      (securitiesData as Array<{ id: string; symbol: string; name: string | null }>).map(
        (item) => ({ id: item.id, symbol: item.symbol, name: item.name })
      )
    );
    setCollateralPositions((collateralRes.data as unknown as CollateralPosition[]) ?? []);
    setRepoTrades((repoTradesRes.data as unknown as RepoTradeWithDetails[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refreshData(orgId);
  }, [orgId]);

  // Filter trades based on tab
  const pendingTrades = useMemo(() =>
    repoTrades.filter(t => t.status === "DRAFT" || t.status === "PENDING_APPROVAL"),
    [repoTrades]
  );

  const approvedTrades = useMemo(() =>
    repoTrades.filter(t => t.status === "APPROVED" || t.status === "POSTED" || t.status === "ACTIVE"),
    [repoTrades]
  );

  // Apply search and filter
  const filterTrades = (trades: RepoTradeWithDetails[]) => {
    return trades.filter(trade => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const symbol = trade.securities?.symbol?.toLowerCase() || "";
        const counterparty = trade.counterparties?.name?.toLowerCase() || "";
        if (!symbol.includes(query) && !counterparty.includes(query)) {
        return false;
      }
      }
      if (filterCounterparty && trade.counterparties?.name !== filterCounterparty) {
        return false;
      }
      if (filterPortfolio) {
        const hasPortfolio = trade.repo_allocations?.some(a => a.portfolio_id === filterPortfolio);
        if (!hasPortfolio) return false;
      }
      return true;
    });
  };

  const filteredPendingTrades = useMemo(() => filterTrades(pendingTrades), [pendingTrades, searchQuery, filterCounterparty, filterPortfolio]);
  const filteredApprovedTrades = useMemo(() => filterTrades(approvedTrades), [approvedTrades, searchQuery, filterCounterparty, filterPortfolio]);

  // Calculate trade values
  const calculateTradeValues = (trade: RepoTradeWithDetails) => {
    const totalPrincipal = trade.repo_allocations?.reduce((sum, a) => sum + (a.principal || 0), 0) || 0;
    const days = (new Date(trade.maturity_date).getTime() - new Date(trade.issue_date).getTime()) / (1000 * 60 * 60 * 24);
    const basis = trade.day_count_basis || 365;
    const interest = totalPrincipal * trade.rate * (days / basis);
    const maturityValue = totalPrincipal + interest;
    return { totalPrincipal, interest, maturityValue, days: Math.round(days) };
  };

  // Extract clean price from external_custodian_ref (format: "CP:cleanPrice|ref")
  const extractCleanPrice = (externalRef: string | null): number => {
    if (!externalRef || !externalRef.startsWith("CP:")) return 0;
    const parts = externalRef.substring(3).split("|");
    return Number(parts[0]) || 0;
  };

  // Get collateral for a trade (NCMV calculation)
  const getCollateralForTrade = (trade: RepoTradeWithDetails) => {
    const allocationIds = trade.repo_allocations?.map(a => a.id) || [];
    const positions = collateralPositions.filter(cp =>
      allocationIds.includes(cp.repo_allocation_id) &&
      (cp.status === "RECEIVED" || cp.status === "ACTIVE")
    );
    
    // Calculate Collateral Value and NCMV for each position
    let totalNcmv = 0;
    let totalCollateralValue = 0;
    
    positions.forEach(cp => {
      const cleanPrice = extractCleanPrice(cp.external_custodian_ref);
      const dirtyPrice = cp.dirty_price || 0;
      const nominals = cp.face_value || 0;
      const haircutPct = cp.haircut_pct || 0;
      
      // If no clean price stored, estimate from dirty price (assume small accrued interest)
      const effectiveCleanPrice = cleanPrice || (dirtyPrice * 0.99);
      
      // Accrued Interest = (Dirty Price - Clean Price) × Nominals / 100
      const accruedInterest = (dirtyPrice - effectiveCleanPrice) * nominals / 100;
      
      // Collateral Value = Dirty Price × Nominals / 100 + Accrued Interest
      const collateralValue = (dirtyPrice * nominals / 100) + accruedInterest;
      
      // NCMV = (Clean Price × Haircut + Accrued Interest per 100) × Nominals / 100
      const ncmv = (effectiveCleanPrice * haircutPct + (dirtyPrice - effectiveCleanPrice)) * nominals / 100;
      
      totalCollateralValue += collateralValue;
      totalNcmv += ncmv;
    });
    
    return { positions, totalCollateralValue, totalNcmv };
  };

  const toggleExpanded = (tradeId: string) => {
    setExpandedTrades(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };

  // Start attaching collateral to a trade
  const startAttaching = (tradeId: string) => {
    setAttachingToTrade(tradeId);
    setCollateralEntries([{
      id: generateId(),
      securityId: "",
      nominals: "",
      cleanPrice: "",
      dirtyPrice: "",
      haircutPct: "0",
      valuationDate: new Date().toISOString().slice(0, 10),
      externalRef: ""
    }]);
    // Auto-expand the trade
    setExpandedTrades(prev => new Set(prev).add(tradeId));
  };

  // Add another collateral entry
  const addCollateralEntry = () => {
    setCollateralEntries(prev => [...prev, {
      id: generateId(),
      securityId: "",
      nominals: "",
      cleanPrice: "",
      dirtyPrice: "",
      haircutPct: "0",
      valuationDate: new Date().toISOString().slice(0, 10),
      externalRef: ""
    }]);
  };

  // Update a collateral entry
  const updateCollateralEntry = (id: string, updates: Partial<CollateralEntry>) => {
    setCollateralEntries(prev => prev.map(entry => 
      entry.id === id ? { ...entry, ...updates } : entry
    ));
  };

  // Remove a collateral entry
  const removeCollateralEntry = (id: string) => {
    setCollateralEntries(prev => prev.filter(entry => entry.id !== id));
  };

  // Calculate totals for entries being added
  const entriesTotal = useMemo(() => {
    return collateralEntries.reduce((acc, entry) => {
      const values = calculateCollateralValues(entry);
      return {
        collateralValue: acc.collateralValue + values.collateralValue,
        accruedInterest: acc.accruedInterest + values.accruedInterest,
        ncmv: acc.ncmv + values.ncmv
      };
    }, { collateralValue: 0, accruedInterest: 0, ncmv: 0 });
  }, [collateralEntries]);

  // Save all collateral entries
  const handleSaveCollateral = async (trade: RepoTradeWithDetails) => {
    if (collateralEntries.length === 0) {
      setError("Add at least one collateral entry.");
      return;
    }

    // Validate entries
    for (const entry of collateralEntries) {
      if (!entry.securityId || !entry.nominals || !entry.cleanPrice || !entry.dirtyPrice) {
        setError("Please fill in all required fields for each collateral entry.");
      return;
      }
    }

    // Use first allocation for now (collateral is tagged to symbol)
    const allocation = trade.repo_allocations?.[0];
    if (!allocation) {
      setError("No allocation found for this trade.");
      return;
    }

    // Insert all entries
    for (const entry of collateralEntries) {
      const values = calculateCollateralValues(entry);
      
      // Store clean price in dirty_price field for now (we'll use market_value to store clean_price * nominals / 100)
      // The actual collateral value is stored and NCMV calculated on display
    const { error: insertError } = await supabase.from("collateral_positions").insert({
      org_id: orgId,
        repo_allocation_id: allocation.id,
        portfolio_id: allocation.portfolio_id,
        collateral_security_id: entry.securityId,
        face_value: Number(entry.nominals),
        dirty_price: Number(entry.dirtyPrice),
        market_value: values.collateralValue, // Store collateral value (dirty price * nominals / 100)
        haircut_pct: Number(entry.haircutPct) / 100,
        valuation_date: entry.valuationDate || new Date().toISOString().slice(0, 10),
      restricted_flag: true,
      status: "RECEIVED",
        external_custodian_ref: `CP:${entry.cleanPrice}|${entry.externalRef || ""}` // Store clean price in external ref temporarily
    });

    if (insertError) {
      setError(insertError.message);
      return;
      }
    }

    setError(null);
    setSuccessMessage(`${collateralEntries.length} collateral position(s) added successfully.`);
    setAttachingToTrade(null);
    setCollateralEntries([]);
    await refreshData(orgId);
  };

  // Cancel attaching
  const cancelAttaching = () => {
    setAttachingToTrade(null);
    setCollateralEntries([]);
  };

  // Start substitution for a collateral position
  const startSubstitution = (positionId: string) => {
    setSubstitutingPositionId(positionId);
    setSubEntry({
      id: generateId(),
      securityId: "",
      nominals: "",
      cleanPrice: "",
      dirtyPrice: "",
      haircutPct: "0",
      valuationDate: new Date().toISOString().slice(0, 10),
      externalRef: ""
    });
    setSubReason("");
  };

  // Cancel substitution
  const cancelSubstitution = () => {
    setSubstitutingPositionId(null);
    setSubEntry({
      id: "",
      securityId: "",
      nominals: "",
      cleanPrice: "",
      dirtyPrice: "",
      haircutPct: "0",
      valuationDate: new Date().toISOString().slice(0, 10),
      externalRef: ""
    });
    setSubReason("");
  };

  // Get original position NCMV for validation
  const getPositionNcmv = (position: CollateralPosition) => {
    const cleanPrice = extractCleanPrice(position.external_custodian_ref);
    const dirtyPrice = position.dirty_price || 0;
    const nominals = position.face_value || 0;
    const haircutPct = position.haircut_pct || 0;
    const effectiveCleanPrice = cleanPrice || (dirtyPrice * 0.99);
    return (effectiveCleanPrice * haircutPct + (dirtyPrice - effectiveCleanPrice)) * nominals / 100;
  };

  // Handle substitution submission
  const handleSubstitute = async () => {
    const oldCollateral = collateralPositions.find(pos => pos.id === substitutingPositionId);
    if (!oldCollateral || !subEntry.securityId) {
      setError("Select a new security for substitution.");
      return;
    }

    const allocation = repoTrades.flatMap(t => t.repo_allocations).find(a => a.id === oldCollateral.repo_allocation_id);
    if (!allocation) {
      setError("Unable to resolve allocation for selected collateral.");
      return;
    }

    const nominals = Number(subEntry.nominals);
    const cleanPrice = Number(subEntry.cleanPrice);
    const dirtyPrice = Number(subEntry.dirtyPrice);
    const haircutInput = Number(subEntry.haircutPct);
    
    if (!nominals || !cleanPrice || !dirtyPrice) {
      setError("Enter valid nominals, clean price, and dirty price.");
      return;
    }

    // Calculate new NCMV and validate against trade maturity value
    const newEntryValues = calculateCollateralValues(subEntry);
    const originalNcmv = getPositionNcmv(oldCollateral);
    
    // Find the trade for this allocation to get maturity value
    const trade = repoTrades.find(t => 
      t.repo_allocations?.some(a => a.id === oldCollateral.repo_allocation_id)
    );
    
    if (trade) {
      const tradeValues = calculateTradeValues(trade);
      const tradeCollateral = getCollateralForTrade(trade);
      
      // Calculate projected total NCMV after substitution
      const projectedTotalNcmv = tradeCollateral.totalNcmv - originalNcmv + newEntryValues.ncmv;
      
      if (projectedTotalNcmv < tradeValues.maturityValue) {
        const proceed = window.confirm(
          `Warning: After this substitution, the projected Total NCMV (LKR ${formatCurrency(projectedTotalNcmv)}) will be less than the Repo Value (LKR ${formatCurrency(tradeValues.maturityValue)}).\n\nThis will result in insufficient collateral coverage.\n\nDo you want to proceed?`
        );
        if (!proceed) return;
      }
    }

    const collateralValue = newEntryValues.collateralValue;
    const valuation = subEntry.valuationDate || new Date().toISOString().slice(0, 10);

    const { data: newCollateral, error: insertError } = await supabase
      .from("collateral_positions")
      .insert({
        org_id: orgId,
        repo_allocation_id: oldCollateral.repo_allocation_id,
        portfolio_id: allocation.portfolio_id,
        collateral_security_id: subEntry.securityId,
        face_value: nominals,
        dirty_price: dirtyPrice,
        market_value: collateralValue,
        haircut_pct: Number.isNaN(haircutInput) ? 0 : haircutInput / 100,
        valuation_date: valuation,
        restricted_flag: true,
        status: "RECEIVED",
        external_custodian_ref: `CP:${cleanPrice}|${subEntry.externalRef || ""}`
      })
      .select("id")
      .single();

    if (insertError || !newCollateral) {
      setError(insertError?.message || "Failed to insert new collateral.");
      return;
    }

    const { error: updateError } = await supabase
      .from("collateral_positions")
      .update({ status: "SUBSTITUTED" })
      .eq("id", oldCollateral.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Try to log substitution (table may not exist, so ignore error)
    try {
      await supabase.from("collateral_substitutions").insert({
        org_id: orgId,
        repo_allocation_id: oldCollateral.repo_allocation_id,
        old_collateral_id: oldCollateral.id,
        new_collateral_id: newCollateral.id,
        reason: subReason || null,
        created_by: userId
      });
    } catch (e) {
      // Ignore if table doesn't exist
      console.log("Could not log substitution:", e);
    }

    setError(null);
    setSuccessMessage("Collateral substitution completed successfully.");
    cancelSubstitution();
    await refreshData(orgId);
  };

  const handleMarkReturned = async (collateralId: string) => {
    const { error: updateError } = await supabase
      .from("collateral_positions")
      .update({ status: "RETURNED" })
      .eq("id", collateralId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccessMessage("Collateral marked as returned.");
    await refreshData(orgId);
  };

  // Render trade card
  const renderTradeCard = (trade: RepoTradeWithDetails, showAttach: boolean = true) => {
    const isExpanded = expandedTrades.has(trade.id);
    const values = calculateTradeValues(trade);
    const collateral = getCollateralForTrade(trade);
    const isAttaching = attachingToTrade === trade.id;
    
    // Include entries being added in NCMV calculation
    const pendingNcmv = isAttaching ? entriesTotal.ncmv : 0;
    const totalNcmv = collateral.totalNcmv + pendingNcmv;
    const isSufficient = totalNcmv >= values.maturityValue;

    return (
      <div key={trade.id} className={`symbol-card ${isExpanded ? "expanded" : ""}`}>
        {/* Card Header */}
        <div className="card-header" onClick={() => toggleExpanded(trade.id)}>
          <div className="card-header-left">
            <span className={`status-badge status-${trade.status.toLowerCase()}`}>{trade.status}</span>
            <span className="symbol-name">{trade.securities?.symbol || "N/A"}</span>
            <span className="counterparty-name">{trade.counterparties?.name}</span>
          </div>
          <div className="card-header-right">
            <div className="value-chip">
              <span className="label">Principal</span>
              <span className="value">LKR {formatCurrency(values.totalPrincipal)}</span>
        </div>
            <div className="value-chip highlight">
              <span className="label">Repo Value</span>
              <span className="value">LKR {formatCurrency(values.maturityValue)}</span>
        </div>
            <div className={`value-chip ${isSufficient ? "sufficient" : "insufficient"}`}>
              <span className="label">NCMV</span>
              <span className="value">LKR {formatCurrency(totalNcmv)}</span>
            </div>
            <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
          </div>
        </div>

        {/* Card Summary Row with Attach Button */}
        <div className="card-summary">
          <div className="summary-item">
            <span className="label">Issue</span>
            <span>{trade.issue_date}</span>
                  </div>
          <div className="summary-item">
            <span className="label">Maturity</span>
            <span>{trade.maturity_date}</span>
                  </div>
          <div className="summary-item">
            <span className="label">Tenor</span>
            <span>{values.days} days</span>
                  </div>
          <div className="summary-item">
            <span className="label">Rate</span>
            <span>{(trade.rate * 100).toFixed(2)}%</span>
                    </div>
          <div className="summary-item">
            <span className="label">Day Count</span>
            <span>{trade.day_count_basis === 365 ? "ACT/365" : "ACT/360"}</span>
                  </div>
          {showAttach && !isAttaching && (
                  <button
              className="attach-btn-inline"
              onClick={(e) => {
                e.stopPropagation();
                startAttaching(trade.id);
              }}
            >
              + Attach Collateral
                  </button>
          )}
                </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="card-expanded">
            {/* Trade Details */}
            <div className="detail-section">
              <h4>Trade Details</h4>
              <div className="detail-grid">
                <div><label>Security Name</label><span>{trade.securities?.name || "N/A"}</span></div>
                <div><label>Interest</label><span className="interest">LKR {formatCurrency(values.interest)}</span></div>
                <div><label>Created</label><span>{new Date(trade.created_at).toLocaleDateString()}</span></div>
                {trade.notes && <div className="full-width"><label>Notes</label><span>{trade.notes}</span></div>}
              </div>
            </div>

            {/* Client Allocations */}
            <div className="detail-section">
              <h4>Client Allocations ({trade.repo_allocations?.length || 0})</h4>
              <div className="allocation-list">
                {trade.repo_allocations?.map(alloc => (
                  <div key={alloc.id} className="allocation-item">
                    <div className="allocation-info">
                      <span className="portfolio-name">{alloc.portfolios?.name || "Unknown"}</span>
                      <span className="principal">LKR {formatCurrency(alloc.principal)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Existing Collateral */}
            {collateral.positions.length > 0 && (
              <div className="detail-section">
                <h4>Attached Collateral ({collateral.positions.length})</h4>
                <table className="collateral-mini-table">
                  <thead>
                    <tr>
                      <th>Security</th>
                      <th>Nominals</th>
                      <th>Clean Price</th>
                      <th>Dirty Price</th>
                      <th>Accrued Int.</th>
                      <th>Coll. Value</th>
                      <th>Haircut %</th>
                      <th>NCMV</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collateral.positions.map(cp => {
                      const cleanPrice = extractCleanPrice(cp.external_custodian_ref);
                      const dirtyPrice = cp.dirty_price || 0;
                      const nominals = cp.face_value || 0;
                      const haircutPct = cp.haircut_pct || 0;
                      const effectiveCleanPrice = cleanPrice || (dirtyPrice * 0.99);
                      // Accrued Interest = (Dirty Price - Clean Price) × Nominals / 100
                      const accruedInterest = (dirtyPrice - effectiveCleanPrice) * nominals / 100;
                      // Collateral Value = Dirty Price × Nominals / 100 + Accrued Interest
                      const collateralValue = (dirtyPrice * nominals / 100) + accruedInterest;
                      // NCMV = (Clean Price × Haircut + Accrued Interest per 100) × Nominals / 100
                      const ncmv = (effectiveCleanPrice * haircutPct + (dirtyPrice - effectiveCleanPrice)) * nominals / 100;
                      const isBeingSubstituted = substitutingPositionId === cp.id;
                      const newEntryValues = isBeingSubstituted ? calculateCollateralValues(subEntry) : null;
                      
                      // Calculate projected total NCMV after substitution
                      const projectedTotalNcmv = isBeingSubstituted && newEntryValues 
                        ? collateral.totalNcmv - ncmv + newEntryValues.ncmv 
                        : null;
                      const isProjectedSufficient = projectedTotalNcmv !== null 
                        ? projectedTotalNcmv >= values.maturityValue 
                        : true;
                      
                      return (
                        <React.Fragment key={cp.id}>
                          <tr className={isBeingSubstituted ? "substituting-row" : ""}>
                            <td>{cp.securities?.symbol || "N/A"}</td>
                            <td>{formatCurrency(nominals)}</td>
                            <td>{effectiveCleanPrice.toFixed(4)}</td>
                            <td>{dirtyPrice.toFixed(4)}</td>
                            <td>{formatCurrency(accruedInterest)}</td>
                            <td>{formatCurrency(collateralValue)}</td>
                            <td>{formatPct(haircutPct)}</td>
                            <td className="ncmv-value">{formatCurrency(ncmv)}</td>
                            <td>
                              {!isBeingSubstituted && (
                                <>
                                  <button className="ghost small" onClick={(e) => { e.stopPropagation(); startSubstitution(cp.id); }}>
                                    Sub
                                  </button>
                                  <button className="ghost small" onClick={(e) => { e.stopPropagation(); handleMarkReturned(cp.id); }}>
                                    Ret
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                          
                          {/* Inline Substitution Form */}
                          {isBeingSubstituted && (
                            <tr className="substitution-form-row">
                              <td colSpan={9}>
                                <div className="inline-substitution-form">
                                  <div className="sub-form-header">
                                    <div className="sub-icon">🔄</div>
                                    <div className="sub-title">
                                      <h4>Substitute Collateral</h4>
                                      <p>Replacing: <strong>{cp.securities?.symbol}</strong> (NCMV: LKR {formatCurrency(ncmv)})</p>
        </div>
                                    <button className="close-btn" onClick={(e) => { e.stopPropagation(); cancelSubstitution(); }}>×</button>
                                  </div>

                                  <div className="sub-form-body">
                                    <div className="sub-form-grid">
          <div>
                                        <label>New Security</label>
            <select
                                          value={subEntry.securityId}
                                          onChange={(e) => setSubEntry(prev => ({ ...prev, securityId: e.target.value }))}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <option value="">Select security...</option>
                                          {collateralSecurities.map(sec => (
                                            <option key={sec.id} value={sec.id}>{sec.name || sec.symbol}</option>
              ))}
            </select>
          </div>
          <div>
                                        <label>Nominals</label>
            <input
              type="number"
                                          value={subEntry.nominals}
                                          onChange={(e) => setSubEntry(prev => ({ ...prev, nominals: e.target.value }))}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="Face value"
            />
          </div>
          <div>
                                        <label>Clean Price</label>
            <input
              type="number"
              step="0.0001"
                                          value={subEntry.cleanPrice}
                                          onChange={(e) => setSubEntry(prev => ({ ...prev, cleanPrice: e.target.value }))}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="e.g. 99.50"
            />
          </div>
          <div>
                                        <label>Dirty Price</label>
            <input
              type="number"
                                          step="0.0001"
                                          value={subEntry.dirtyPrice}
                                          onChange={(e) => setSubEntry(prev => ({ ...prev, dirtyPrice: e.target.value }))}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="e.g. 100.25"
            />
          </div>
          <div>
            <label>Haircut %</label>
            <input
              type="number"
                                          step="0.01"
                                          value={subEntry.haircutPct}
                                          onChange={(e) => setSubEntry(prev => ({ ...prev, haircutPct: e.target.value }))}
                                          onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div>
            <label>Valuation Date</label>
            <input
              type="date"
                                          value={subEntry.valuationDate}
                                          onChange={(e) => setSubEntry(prev => ({ ...prev, valuationDate: e.target.value }))}
                                          onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div>
                                        <label>External Ref</label>
            <input
                                          value={subEntry.externalRef}
                                          onChange={(e) => setSubEntry(prev => ({ ...prev, externalRef: e.target.value }))}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="Optional"
            />
          </div>
                  <div>
                                        <label>Reason</label>
                                        <input
                                          value={subReason}
                                          onChange={(e) => setSubReason(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="Reason for substitution"
                                        />
        </div>
        </div>

                                    <div className="sub-form-calculated">
                                      <div className="calc-comparison">
                                        <div className="calc-side original">
                                          <span className="calc-label">Current Total NCMV</span>
                                          <span className="calc-value">LKR {formatCurrency(collateral.totalNcmv)}</span>
                                        </div>
                                        <div className="calc-arrow">→</div>
                                        <div className={`calc-side new ${isProjectedSufficient ? "ok" : projectedTotalNcmv && projectedTotalNcmv > 0 ? "warning" : ""}`}>
                                          <span className="calc-label">Projected NCMV</span>
                                          <span className="calc-value">LKR {formatCurrency(projectedTotalNcmv || 0)}</span>
                                        </div>
                                        <div className="calc-side target">
                                          <span className="calc-label">Repo Value</span>
                                          <span className="calc-value">LKR {formatCurrency(values.maturityValue)}</span>
                                        </div>
                                      </div>
                                      <div className="calc-details">
                                        <div className="calc-item">
                                          <span className="label">Removing</span>
                                          <span className="negative">-LKR {formatCurrency(ncmv)}</span>
                                        </div>
                                        <div className="calc-item">
                                          <span className="label">Adding</span>
                                          <span className="positive">+LKR {formatCurrency(newEntryValues?.ncmv || 0)}</span>
                                        </div>
                                        <div className="calc-item">
                                          <span className="label">Accrued Int.</span>
                                          <span>{formatCurrency(newEntryValues?.accruedInterest || 0)}</span>
                                        </div>
                                        <div className="calc-item">
                                          <span className="label">Coll. Value</span>
                                          <span>{formatCurrency(newEntryValues?.collateralValue || 0)}</span>
                                        </div>
                                      </div>
                                      {projectedTotalNcmv !== null && !isProjectedSufficient && (
                                        <div className="ncmv-warning">
                                          ⚠️ Projected Total NCMV (LKR {formatCurrency(projectedTotalNcmv)}) will be below Repo Value (LKR {formatCurrency(values.maturityValue)}). Coverage will be insufficient.
                                        </div>
                                      )}
                                    </div>
                                    
                                    <div className="sub-form-actions">
                                      <button className="ghost" onClick={(e) => { e.stopPropagation(); cancelSubstitution(); }}>
                                        Cancel
                  </button>
                  <button
                                        className="primary" 
                                        onClick={(e) => { e.stopPropagation(); handleSubstitute(); }}
                                        disabled={!subEntry.securityId || !subEntry.nominals || !subEntry.cleanPrice || !subEntry.dirtyPrice}
                  >
                                        Substitute Collateral
                  </button>
                </div>
              </div>
              </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
            );
          })}
                    <tr className="totals-row">
                      <td colSpan={5}><strong>Total</strong></td>
                      <td><strong>{formatCurrency(collateral.totalCollateralValue)}</strong></td>
                      <td></td>
                      <td className="ncmv-value"><strong>{formatCurrency(collateral.totalNcmv)}</strong></td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
          </div>
        )}

            {/* Inline Collateral Entry Form */}
            {isAttaching && (
              <div className="inline-collateral-form">
                <div className="form-header-inline">
                  <h4>Add Collateral to {trade.securities?.symbol}</h4>
                  <div className="ncmv-summary">
                    <span className="label">Repo Value:</span>
                    <span className="repo-value">LKR {formatCurrency(values.maturityValue)}</span>
                    <span className="label">Total NCMV:</span>
                    <span className={`ncmv-total ${isSufficient ? "sufficient" : "insufficient"}`}>
                      LKR {formatCurrency(totalNcmv)}
                      {isSufficient ? " ✓" : " ⚠️"}
                    </span>
          </div>
                </div>

                {collateralEntries.map((entry, index) => {
                  const entryValues = calculateCollateralValues(entry);
                  return (
                    <div key={entry.id} className="collateral-entry-row">
                      <div className="entry-header">
                        <span className="entry-number">#{index + 1}</span>
                        {collateralEntries.length > 1 && (
                          <button className="remove-entry-btn" onClick={() => removeCollateralEntry(entry.id)}>×</button>
                        )}
          </div>
                      <div className="entry-grid">
          <div>
                          <label>Security</label>
            <select
                            value={entry.securityId} 
                            onChange={(e) => updateCollateralEntry(entry.id, { securityId: e.target.value })}
                          >
                            <option value="">Select...</option>
                            {collateralSecurities.map(sec => (
                              <option key={sec.id} value={sec.id}>{sec.name || sec.symbol}</option>
              ))}
            </select>
          </div>
          <div>
                          <label>Nominals</label>
            <input
              type="number"
                            value={entry.nominals} 
                            onChange={(e) => updateCollateralEntry(entry.id, { nominals: e.target.value })}
                            placeholder="Face value"
            />
          </div>
          <div>
                          <label>Clean Price</label>
            <input
              type="number"
              step="0.0001"
                            value={entry.cleanPrice} 
                            onChange={(e) => updateCollateralEntry(entry.id, { cleanPrice: e.target.value })}
                            placeholder="e.g. 99.50"
            />
          </div>
          <div>
                          <label>Dirty Price</label>
            <input
              type="number"
                            step="0.0001"
                            value={entry.dirtyPrice} 
                            onChange={(e) => updateCollateralEntry(entry.id, { dirtyPrice: e.target.value })}
                            placeholder="e.g. 100.25"
            />
          </div>
          <div>
            <label>Haircut %</label>
            <input
              type="number"
                            step="0.01"
                            value={entry.haircutPct} 
                            onChange={(e) => updateCollateralEntry(entry.id, { haircutPct: e.target.value })}
            />
          </div>
          <div>
            <label>Valuation Date</label>
            <input
              type="date"
                            value={entry.valuationDate} 
                            onChange={(e) => updateCollateralEntry(entry.id, { valuationDate: e.target.value })}
            />
          </div>
          <div>
                          <label>External Ref</label>
            <input
                            value={entry.externalRef} 
                            onChange={(e) => updateCollateralEntry(entry.id, { externalRef: e.target.value })}
                            placeholder="Optional"
            />
          </div>
        </div>
                      <div className="entry-calculated">
                        <div className="calc-item">
                          <span className="label">Accrued Int.</span>
                          <span>{formatCurrency(entryValues.accruedInterest)}</span>
        </div>
                        <div className="calc-item">
                          <span className="label">Coll. Value</span>
                          <span>{formatCurrency(entryValues.collateralValue)}</span>
                        </div>
                        <div className="calc-item highlight">
                          <span className="label">NCMV</span>
                          <span>{formatCurrency(entryValues.ncmv)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="form-actions-inline">
                  <button className="secondary" onClick={addCollateralEntry}>+ Add Another</button>
                  <div className="right-actions">
                    <button className="ghost" onClick={cancelAttaching}>Cancel</button>
                    <button className="primary" onClick={() => handleSaveCollateral(trade)}>
                      Save {collateralEntries.length} Collateral{collateralEntries.length > 1 ? "s" : ""}
                    </button>
                  </div>
                  </div>
                  </div>
            )}
                  </div>
        )}
      </div>
    );
  };

  // Calculate monitor analytics
  const monitorAnalytics = useMemo(() => {
    const trades = filteredApprovedTrades;
    let totalPrincipal = 0;
    let totalMaturityValue = 0;
    let totalNcmv = 0;
    let fullyCovered = 0;
    let warnings = 0;
    let shortfalls = 0;

    trades.forEach(trade => {
      const values = calculateTradeValues(trade);
      const collateral = getCollateralForTrade(trade);
      totalPrincipal += values.totalPrincipal;
      totalMaturityValue += values.maturityValue;
      totalNcmv += collateral.totalNcmv;

      const ratio = values.maturityValue > 0 ? collateral.totalNcmv / values.maturityValue : 1;
      if (ratio >= 1) fullyCovered++;
      else if (ratio >= 0.95) warnings++;
      else shortfalls++;
    });

    return { totalPrincipal, totalMaturityValue, totalNcmv, fullyCovered, warnings, shortfalls, total: trades.length };
  }, [filteredApprovedTrades, collateralPositions]);

  if (loading) {
    return (
      <main>
        <section>
          <h2>Loading collateral workspace...</h2>
          <p>Fetching trades and collateral data.</p>
        </section>
      </main>
    );
  }

  if (error === "Please sign in to manage collateral.") {
    return null;
  }

  return (
    <main>
      {error && (
        <section className="info-banner error-banner">
          <p>❌ {error}</p>
        </section>
      )}

      {successMessage && (
        <section className="info-banner success-banner">
          <p>✅ {successMessage}</p>
        </section>
      )}

      {/* Tabs */}
      <div className="tabs-container">
        <button className={`tab-button ${activeTab === "attach" ? "active" : ""}`} onClick={() => setActiveTab("attach")}>
          Attach ({filteredPendingTrades.length})
                  </button>
        <button className={`tab-button ${activeTab === "substitute" ? "active" : ""}`} onClick={() => setActiveTab("substitute")}>
          Substitute ({filteredApprovedTrades.length})
        </button>
        <button className={`tab-button ${activeTab === "monitor" ? "active" : ""}`} onClick={() => setActiveTab("monitor")}>
          Monitor ({filteredApprovedTrades.length})
                  </button>
                </div>

      {/* Search and Filter */}
      <div className="search-filter-bar">
        <div className="search-box">
            <input
            type="text"
            placeholder="Search by symbol or counterparty..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        <div className="filter-group">
          <select value={filterCounterparty} onChange={(e) => setFilterCounterparty(e.target.value)}>
            <option value="">All Counterparties</option>
            {counterparties.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select value={filterPortfolio} onChange={(e) => setFilterPortfolio(e.target.value)}>
            <option value="">All Clients</option>
            {portfolios.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {orgOptions.length > 1 && (
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {orgOptions.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          )}
        </div>
        </div>

      {/* Tab Content */}
      {activeTab === "attach" && (
        <section className="tab-content">
          <h2>Pending Trades - Attach Collateral</h2>
          <p className="section-description">
            Attach collateral to pending trades. NCMV must equal or exceed Repo Value for approval.
          </p>
          
          {filteredPendingTrades.length === 0 ? (
            <div className="empty-state-card">
              <p>No pending trades found.</p>
            </div>
          ) : (
            <div className="symbol-cards-list">
              {filteredPendingTrades.map(trade => renderTradeCard(trade, true))}
          </div>
        )}
      </section>
      )}

      {activeTab === "substitute" && (
        <section className="tab-content">
          <h2>Approved Trades - Substitute Collateral</h2>
          <p className="section-description">
            Replace existing collateral with new securities. Click "Sub" on any collateral position to start substitution.
          </p>
          
          {filteredApprovedTrades.length === 0 ? (
            <div className="empty-state-card">
              <p>No approved trades found matching your filters.</p>
            </div>
          ) : (
            <div className="symbol-cards-list">
              {filteredApprovedTrades.map(trade => renderTradeCard(trade, false))}
            </div>
          )}
        </section>
      )}

      {activeTab === "monitor" && (
        <section className="tab-content">
          <h2>Collateral Monitor - Analytics</h2>
          <p className="section-description">
            Monitor collateral coverage and exceptions for all approved trades.
          </p>

          {/* Analytics Summary */}
          <div className="analytics-summary">
            <div className="analytics-card">
              <span className="analytics-label">Total Trades</span>
              <span className="analytics-value">{monitorAnalytics.total}</span>
            </div>
            <div className="analytics-card ok">
              <span className="analytics-label">Fully Covered</span>
              <span className="analytics-value">{monitorAnalytics.fullyCovered}</span>
            </div>
            <div className="analytics-card warning">
              <span className="analytics-label">Warnings (95-100%)</span>
              <span className="analytics-value">{monitorAnalytics.warnings}</span>
            </div>
            <div className="analytics-card shortfall">
              <span className="analytics-label">Shortfalls (&lt;95%)</span>
              <span className="analytics-value">{monitorAnalytics.shortfalls}</span>
            </div>
            <div className="analytics-card">
              <span className="analytics-label">Total Principal</span>
              <span className="analytics-value">LKR {formatCurrency(monitorAnalytics.totalPrincipal)}</span>
            </div>
            <div className="analytics-card highlight">
              <span className="analytics-label">Total Repo Value</span>
              <span className="analytics-value">LKR {formatCurrency(monitorAnalytics.totalMaturityValue)}</span>
            </div>
            <div className={`analytics-card ${monitorAnalytics.totalNcmv >= monitorAnalytics.totalMaturityValue ? "ok" : "shortfall"}`}>
              <span className="analytics-label">Total NCMV</span>
              <span className="analytics-value">LKR {formatCurrency(monitorAnalytics.totalNcmv)}</span>
            </div>
          </div>

          {/* Exceptions Queue */}
          {monitorAnalytics.shortfalls > 0 && (
            <div className="exceptions-section">
              <h3>⚠️ Exceptions Queue ({monitorAnalytics.shortfalls + monitorAnalytics.warnings})</h3>
              <div className="symbol-cards-list">
                {filteredApprovedTrades
                  .filter(trade => {
                    const values = calculateTradeValues(trade);
                    const collateral = getCollateralForTrade(trade);
                    const ratio = values.maturityValue > 0 ? collateral.totalNcmv / values.maturityValue : 1;
                    return ratio < 1;
                  })
                  .map(trade => renderTradeCard(trade, false))}
              </div>
            </div>
          )}

          {/* All Approved Trades */}
          <div className="all-trades-section">
            <h3>All Approved Trades</h3>
            {filteredApprovedTrades.length === 0 ? (
              <div className="empty-state-card">
                <p>No approved trades found matching your filters.</p>
              </div>
            ) : (
              <div className="symbol-cards-list">
                {filteredApprovedTrades.map(trade => renderTradeCard(trade, false))}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
