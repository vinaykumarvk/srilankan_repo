"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrgOption = { id: string; name: string };

type Counterparty = {
  id: string;
  name: string;
  short_code: string;
};

type ConfigSettings = {
  coverage_method: string | null;
  coverage_buffer_pct: number | null;
};

type RepoAllocation = {
  id: string;
  portfolio_id: string;
  principal: number;
  status: string;
  repo_trades: {
    id: string;
    counterparty_id: string;
    issue_date: string;
    maturity_date: string;
    rate: number;
    day_count_basis: number;
    status: string;
  } | null;
  portfolios: { name: string } | null;
};

type CollateralCoverage = {
  repo_allocation_id: string;
  principal: number;
  expected_interest: number;
  maturity_proceeds: number;
  total_market_value: number;
  total_haircut_value: number;
  required_collateral_value: number;
  coverage_basis_value: number;
  coverage_ratio: number | null;
  shortfall: number;
  excess: number;
};

type CounterpartyExposure = {
  counterpartyId: string;
  counterpartyName: string;
  shortCode: string;
  totalPrincipal: number;
  totalAccruedInterest: number;
  totalMaturityProceeds: number;
  totalRequiredCollateral: number;
  totalCoverageBasis: number;
  totalMarketValue: number;
  totalHaircutValue: number;
  coverageRatio: number;
  allocationCount: number;
  maturityBuckets: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    beyond: number;
  };
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 }).format(value);

const formatPct = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>("");

  const [configSettings, setConfigSettings] = useState<ConfigSettings | null>(null);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [allocations, setAllocations] = useState<RepoAllocation[]>([]);
  const [coverageRows, setCoverageRows] = useState<CollateralCoverage[]>([]);

  const [activeTab, setActiveTab] = useState<"EXPOSURE" | "MATURITY" | "EXCEPTIONS">("EXPOSURE");
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to view reports.");
        setLoading(false);
        return;
      }

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

    const [counterpartyRes, allocationRes, coverageRes, configRes] = await Promise.all([
      supabase
        .from("counterparties")
        .select("id, name, short_code")
        .eq("org_id", targetOrgId),
      supabase
        .from("repo_allocations")
        .select(
          "id, portfolio_id, principal, status, repo_trades ( id, counterparty_id, issue_date, maturity_date, rate, day_count_basis, status ), portfolios ( name )"
        )
        .eq("org_id", targetOrgId)
        .in("status", ["ACTIVE", "POSTED", "APPROVED"]),
      supabase
        .from("collateral_coverage")
        .select(
          "repo_allocation_id, principal, expected_interest, maturity_proceeds, total_market_value, total_haircut_value, required_collateral_value, coverage_basis_value, coverage_ratio, shortfall, excess"
        )
        .eq("org_id", targetOrgId)
        .order("repo_allocation_id", { ascending: true }),
      supabase
        .from("config_settings")
        .select("coverage_method, coverage_buffer_pct")
        .eq("org_id", targetOrgId)
        .maybeSingle()
    ]);

    if (counterpartyRes.error || allocationRes.error || coverageRes.error || configRes.error) {
      setError(
        counterpartyRes.error?.message ||
          allocationRes.error?.message ||
          coverageRes.error?.message ||
          configRes.error?.message ||
          "Failed to load report data."
      );
      setLoading(false);
      return;
    }

    setConfigSettings((configRes.data as ConfigSettings | null) ?? null);
    setCounterparties((counterpartyRes.data as Counterparty[]) ?? []);
    setAllocations((allocationRes.data as unknown as RepoAllocation[]) ?? []);
    setCoverageRows((coverageRes.data as CollateralCoverage[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (orgId) {
      refreshData(orgId);
    }
  }, [orgId]);

  const coverageByAllocation = useMemo(() => {
    const map = new Map<string, CollateralCoverage>();
    coverageRows.forEach((row) => {
      map.set(row.repo_allocation_id, row);
    });
    return map;
  }, [coverageRows]);

  const coverageMethod = (configSettings?.coverage_method ?? "HAIRCUT_VALUE").toUpperCase();
  const coverageBufferPct = configSettings?.coverage_buffer_pct ?? 0;
  const coverageBasisLabel =
    coverageMethod === "BUFFER_PCT" ? "Collateral MV" : "Haircut Value";
  const requiredCollateralLabel =
    coverageMethod === "BUFFER_PCT"
      ? `Required (Proceeds + ${formatPct(coverageBufferPct)})`
      : "Required Collateral";
  const coveragePolicyLabel =
    coverageMethod === "BUFFER_PCT"
      ? `Buffer ${formatPct(coverageBufferPct)}`
      : "Haircut Value";

  // Build counterparty exposure data
  const counterpartyExposures = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);
    const endOfMonth = new Date(today);
    endOfMonth.setMonth(today.getMonth() + 1);

    const exposureMap = new Map<string, CounterpartyExposure>();

    allocations.forEach((alloc) => {
      if (!alloc.repo_trades) return;
      const trade = alloc.repo_trades;
      const cpId = trade.counterparty_id;
      const cp = counterparties.find((c) => c.id === cpId);
      if (!cp) return;

      const coverage = coverageByAllocation.get(alloc.id);
      const interest = coverage?.expected_interest ?? 0;
      const proceeds = coverage?.maturity_proceeds ?? alloc.principal + interest;
      const requiredCollateral = coverage?.required_collateral_value ?? proceeds;
      const coverageBasis = coverage?.coverage_basis_value ?? 0;
      const coverageRatio =
        requiredCollateral > 0 ? coverageBasis / requiredCollateral : 1;
      const totalMarketValue = coverage?.total_market_value ?? 0;
      const totalHaircutValue = coverage?.total_haircut_value ?? 0;

      const maturityDate = new Date(trade.maturity_date);
      maturityDate.setHours(0, 0, 0, 0);

      let existing = exposureMap.get(cpId);
      if (!existing) {
        existing = {
          counterpartyId: cpId,
          counterpartyName: cp.name,
          shortCode: cp.short_code,
          totalPrincipal: 0,
          totalAccruedInterest: 0,
          totalMaturityProceeds: 0,
          totalRequiredCollateral: 0,
          totalCoverageBasis: 0,
          totalMarketValue: 0,
          totalHaircutValue: 0,
          coverageRatio: 0,
          allocationCount: 0,
          maturityBuckets: { today: 0, thisWeek: 0, thisMonth: 0, beyond: 0 }
        };
      }

      existing.totalPrincipal += alloc.principal;
      existing.totalAccruedInterest += interest;
      existing.totalMaturityProceeds += proceeds;
      existing.totalRequiredCollateral += requiredCollateral;
      existing.totalCoverageBasis += coverageBasis;
      existing.totalMarketValue += totalMarketValue;
      existing.totalHaircutValue += totalHaircutValue;
      existing.allocationCount += 1;

      // Bucket by maturity
      if (maturityDate.getTime() === today.getTime()) {
        existing.maturityBuckets.today += alloc.principal;
      } else if (maturityDate < endOfWeek) {
        existing.maturityBuckets.thisWeek += alloc.principal;
      } else if (maturityDate < endOfMonth) {
        existing.maturityBuckets.thisMonth += alloc.principal;
      } else {
        existing.maturityBuckets.beyond += alloc.principal;
      }

      exposureMap.set(cpId, existing);
    });

    // Compute coverage ratios
    exposureMap.forEach((exp) => {
      exp.coverageRatio =
        exp.totalRequiredCollateral > 0
          ? exp.totalCoverageBasis / exp.totalRequiredCollateral
          : 1;
    });

    return Array.from(exposureMap.values()).sort(
      (a, b) => b.totalPrincipal - a.totalPrincipal
    );
  }, [allocations, counterparties, coverageByAllocation]);

  // Totals
  const totals = useMemo(() => {
    return counterpartyExposures.reduce(
      (acc, exp) => {
        acc.principal += exp.totalPrincipal;
        acc.interest += exp.totalAccruedInterest;
        acc.proceeds += exp.totalMaturityProceeds;
        acc.requiredCollateral += exp.totalRequiredCollateral;
        acc.coverageBasis += exp.totalCoverageBasis;
        acc.marketValue += exp.totalMarketValue;
        acc.haircutValue += exp.totalHaircutValue;
        acc.allocations += exp.allocationCount;
        acc.today += exp.maturityBuckets.today;
        acc.thisWeek += exp.maturityBuckets.thisWeek;
        acc.thisMonth += exp.maturityBuckets.thisMonth;
        acc.beyond += exp.maturityBuckets.beyond;
        return acc;
      },
      {
        principal: 0,
        interest: 0,
        proceeds: 0,
        requiredCollateral: 0,
        coverageBasis: 0,
        marketValue: 0,
        haircutValue: 0,
        allocations: 0,
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        beyond: 0
      }
    );
  }, [counterpartyExposures]);

  const totalCoverageRatio =
    totals.requiredCollateral > 0 ? totals.coverageBasis / totals.requiredCollateral : 1;

  // Maturity calendar data
  const maturityCalendar = useMemo(() => {
    const calendar = new Map<string, { principal: number; allocations: RepoAllocation[] }>();

    allocations.forEach((alloc) => {
      if (!alloc.repo_trades) return;
      const maturityDate = alloc.repo_trades.maturity_date;
      const existing = calendar.get(maturityDate) || { principal: 0, allocations: [] };
      existing.principal += alloc.principal;
      existing.allocations.push(alloc);
      calendar.set(maturityDate, existing);
    });

    return Array.from(calendar.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        principal: data.principal,
        count: data.allocations.length,
        allocations: data.allocations
      }));
  }, [allocations]);

  // Exceptions: shortfalls and issues
  const exceptions = useMemo(() => {
    const issues: Array<{
      type: "SHORTFALL" | "WARNING" | "PENDING_COLLATERAL";
      severity: "HIGH" | "MEDIUM" | "LOW";
      allocation: RepoAllocation;
      message: string;
      shortfall?: number;
    }> = [];

    allocations.forEach((alloc) => {
      if (!alloc.repo_trades) return;
      const trade = alloc.repo_trades;

      const coverage = coverageByAllocation.get(alloc.id);
      const requiredCollateral = coverage?.required_collateral_value ?? 0;
      const coverageBasis = coverage?.coverage_basis_value ?? 0;
      const coverageRatio =
        requiredCollateral > 0 ? coverageBasis / requiredCollateral : 1;
      const shortfall = coverage?.shortfall ?? Math.max(requiredCollateral - coverageBasis, 0);
      const totalMarketValue = coverage?.total_market_value ?? 0;

      if (totalMarketValue === 0) {
        issues.push({
          type: "PENDING_COLLATERAL",
          severity: "HIGH",
          allocation: alloc,
          message: "No collateral captured for this allocation"
        });
      } else if (coverageRatio < 0.95) {
        issues.push({
          type: "SHORTFALL",
          severity: "HIGH",
          allocation: alloc,
          message: `Collateral shortfall: ${formatPct(coverageRatio)} coverage`,
          shortfall
        });
      } else if (coverageRatio < 1) {
        issues.push({
          type: "WARNING",
          severity: "MEDIUM",
          allocation: alloc,
          message: `Marginal coverage: ${formatPct(coverageRatio)}`,
          shortfall
        });
      }
    });

    return issues.sort((a, b) => {
      const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }, [allocations, coverageByAllocation]);

  const handleExportCsv = (type: "EXPOSURE" | "MATURITY" | "EXCEPTIONS") => {
    let csvContent = "";
    let filename = "";

    if (type === "EXPOSURE") {
      const headers = [
        "Counterparty",
        "Code",
        "Principal",
        "Interest",
        "Maturity Proceeds",
        requiredCollateralLabel,
        coverageBasisLabel,
        "Coverage",
        "Allocations",
        "Today",
        "This Week",
        "This Month",
        "Beyond"
      ];
      const rows = counterpartyExposures.map((exp) => [
        exp.counterpartyName,
        exp.shortCode,
        exp.totalPrincipal,
        exp.totalAccruedInterest.toFixed(2),
        exp.totalMaturityProceeds.toFixed(2),
        exp.totalRequiredCollateral.toFixed(2),
        exp.totalCoverageBasis.toFixed(2),
        (exp.coverageRatio * 100).toFixed(1) + "%",
        exp.allocationCount,
        exp.maturityBuckets.today,
        exp.maturityBuckets.thisWeek,
        exp.maturityBuckets.thisMonth,
        exp.maturityBuckets.beyond
      ]);
      csvContent = [headers, ...rows].map((r) => r.join(",")).join("\n");
      filename = "counterparty_exposure.csv";
    } else if (type === "MATURITY") {
      const headers = ["Maturity Date", "Principal", "Allocation Count"];
      const rows = maturityCalendar.map((m) => [m.date, m.principal, m.count]);
      csvContent = [headers, ...rows].map((r) => r.join(",")).join("\n");
      filename = "maturity_calendar.csv";
    } else {
      const headers = ["Type", "Severity", "Portfolio", "Principal", "Message", "Shortfall"];
      const rows = exceptions.map((e) => [
        e.type,
        e.severity,
        e.allocation.portfolios?.name || "",
        e.allocation.principal,
        e.message,
        e.shortfall?.toFixed(2) || ""
      ]);
      csvContent = [headers, ...rows].map((r) => r.join(",")).join("\n");
      filename = "exceptions.csv";
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <main>
        <section>
          <h2>Loading reports...</h2>
        </section>
      </main>
    );
  }

  // Auth is handled by AppShell
  if (error === "Please sign in to view reports.") {
    return null;
  }

  return (
    <main>
      {/* Critical alerts indicator */}
      {exceptions.filter((e) => e.severity === "HIGH").length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div
            className="badge"
            style={{ backgroundColor: "#ef4444", color: "white" }}
          >
            {exceptions.filter((e) => e.severity === "HIGH").length} Critical Issues
          </div>
          <span style={{ marginLeft: "12px", color: "#666", fontSize: "12px" }}>
            Coverage policy: {coveragePolicyLabel}
          </span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="report-tabs" style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <button
          className={activeTab === "EXPOSURE" ? "primary" : "secondary"}
          onClick={() => setActiveTab("EXPOSURE")}
        >
          Counterparty Exposure
        </button>
        <button
          className={activeTab === "MATURITY" ? "primary" : "secondary"}
          onClick={() => setActiveTab("MATURITY")}
        >
          Maturity Calendar
        </button>
        <button
          className={activeTab === "EXCEPTIONS" ? "primary" : "secondary"}
          onClick={() => setActiveTab("EXCEPTIONS")}
          style={{
            position: "relative"
          }}
        >
          Exceptions
          {exceptions.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: "-8px",
                right: "-8px",
                backgroundColor: "#ef4444",
                color: "white",
                borderRadius: "50%",
                width: "20px",
                height: "20px",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              {exceptions.length}
            </span>
          )}
        </button>
      </div>

      {/* Organization selector */}
      {orgOptions.length > 1 && (
        <section style={{ marginBottom: "24px", padding: "16px" }}>
          <div>
            <label>Organization</label>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              style={{ maxWidth: "300px" }}
            >
              {orgOptions.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      {/* COUNTERPARTY EXPOSURE TAB */}
      {activeTab === "EXPOSURE" && (
        <>
          <section className="summary-card" style={{ marginBottom: "24px" }}>
            <div className="summary-item">
              <label>Total Principal</label>
              <div>LKR {formatCurrency(totals.principal)}</div>
            </div>
            <div className="summary-item">
              <label>Accrued Interest</label>
              <div>LKR {formatCurrency(totals.interest)}</div>
            </div>
            <div className="summary-item">
              <label>Maturity Proceeds</label>
              <div>LKR {formatCurrency(totals.proceeds)}</div>
            </div>
            <div className="summary-item">
              <label>{requiredCollateralLabel}</label>
              <div>LKR {formatCurrency(totals.requiredCollateral)}</div>
            </div>
            <div className="summary-item">
              <label>{coverageBasisLabel}</label>
              <div>LKR {formatCurrency(totals.coverageBasis)}</div>
            </div>
            <div className="summary-item">
              <label>Overall Coverage</label>
              <div
                style={{
                  color: totalCoverageRatio >= 1 ? "#22c55e" : totalCoverageRatio >= 0.95 ? "#f59e0b" : "#ef4444"
                }}
              >
                {formatPct(totalCoverageRatio)}
              </div>
            </div>
            <div className="summary-item">
              <label>Counterparties</label>
              <div>{counterpartyExposures.length}</div>
            </div>
          </section>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2>Exposure by Counterparty</h2>
              <button className="secondary" onClick={() => handleExportCsv("EXPOSURE")}>
                Export CSV
              </button>
            </div>

            <div className="allocations">
              {counterpartyExposures.map((exp) => (
                <div
                  key={exp.counterpartyId}
                  className="allocation-row"
                  style={{
                    borderLeft: `4px solid ${
                      exp.coverageRatio >= 1 ? "#22c55e" : exp.coverageRatio >= 0.95 ? "#f59e0b" : "#ef4444"
                    }`
                  }}
                >
                  <div className="row-grid">
                    <div>
                      <label>Counterparty</label>
                      <div style={{ fontWeight: 600 }}>{exp.counterpartyName}</div>
                      <div style={{ fontSize: "12px", color: "#666" }}>{exp.shortCode}</div>
                    </div>
                    <div>
                      <label>Principal</label>
                      <div>LKR {formatCurrency(exp.totalPrincipal)}</div>
                    </div>
                    <div>
                      <label>Interest</label>
                      <div>LKR {formatCurrency(exp.totalAccruedInterest)}</div>
                    </div>
                    <div>
                      <label>Maturity Proceeds</label>
                      <div style={{ fontWeight: 600 }}>LKR {formatCurrency(exp.totalMaturityProceeds)}</div>
                    </div>
                    <div>
                      <label>{requiredCollateralLabel}</label>
                      <div>LKR {formatCurrency(exp.totalRequiredCollateral)}</div>
                    </div>
                    <div>
                      <label>{coverageBasisLabel}</label>
                      <div>LKR {formatCurrency(exp.totalCoverageBasis)}</div>
                    </div>
                    <div>
                      <label>Coverage</label>
                      <div
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor:
                            exp.coverageRatio >= 1 ? "#22c55e" : exp.coverageRatio >= 0.95 ? "#f59e0b" : "#ef4444",
                          color: "white",
                          fontWeight: 600,
                          fontSize: "12px"
                        }}
                      >
                        {formatPct(exp.coverageRatio)}
                      </div>
                    </div>
                    <div>
                      <label>Allocations</label>
                      <div>{exp.allocationCount}</div>
                    </div>
                  </div>

                  {/* Maturity buckets */}
                  <div style={{ marginTop: "12px", display: "flex", gap: "16px", fontSize: "12px" }}>
                    <span style={{ color: "#ef4444" }}>
                      Today: LKR {formatCurrency(exp.maturityBuckets.today)}
                    </span>
                    <span style={{ color: "#f59e0b" }}>
                      This Week: LKR {formatCurrency(exp.maturityBuckets.thisWeek)}
                    </span>
                    <span style={{ color: "#3b82f6" }}>
                      This Month: LKR {formatCurrency(exp.maturityBuckets.thisMonth)}
                    </span>
                    <span style={{ color: "#666" }}>
                      Beyond: LKR {formatCurrency(exp.maturityBuckets.beyond)}
                    </span>
                  </div>
                </div>
              ))}

              {!counterpartyExposures.length && (
                <div className="allocation-row">
                  <p>No active repo exposures found.</p>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* MATURITY CALENDAR TAB */}
      {activeTab === "MATURITY" && (
        <>
          <section className="summary-card" style={{ marginBottom: "24px" }}>
            <div className="summary-item">
              <label>Maturing Today</label>
              <div style={{ color: "#ef4444", fontWeight: 600 }}>
                LKR {formatCurrency(totals.today)}
              </div>
            </div>
            <div className="summary-item">
              <label>This Week</label>
              <div style={{ color: "#f59e0b" }}>LKR {formatCurrency(totals.thisWeek)}</div>
            </div>
            <div className="summary-item">
              <label>This Month</label>
              <div style={{ color: "#3b82f6" }}>LKR {formatCurrency(totals.thisMonth)}</div>
            </div>
            <div className="summary-item">
              <label>Beyond</label>
              <div>LKR {formatCurrency(totals.beyond)}</div>
            </div>
            <div className="summary-item">
              <label>Total Allocations</label>
              <div>{totals.allocations}</div>
            </div>
          </section>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2>Maturity Calendar</h2>
              <button className="secondary" onClick={() => handleExportCsv("MATURITY")}>
                Export CSV
              </button>
            </div>

            <div className="allocations">
              {maturityCalendar.map((day) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const maturityDate = new Date(day.date);
                maturityDate.setHours(0, 0, 0, 0);
                const isToday = maturityDate.getTime() === today.getTime();
                const isPast = maturityDate < today;

                return (
                  <div
                    key={day.date}
                    className="allocation-row"
                    style={{
                      borderLeft: `4px solid ${isToday ? "#ef4444" : isPast ? "#6b7280" : "#22c55e"}`,
                      backgroundColor: isToday ? "#fee2e2" : isPast ? "#f3f4f6" : undefined
                    }}
                  >
                    <div className="row-grid">
                      <div>
                        <label>Maturity Date</label>
                        <div style={{ fontWeight: 600 }}>
                          {day.date}
                          {isToday && (
                            <span
                              style={{
                                marginLeft: "8px",
                                backgroundColor: "#ef4444",
                                color: "white",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px"
                              }}
                            >
                              TODAY
                            </span>
                          )}
                          {isPast && (
                            <span
                              style={{
                                marginLeft: "8px",
                                backgroundColor: "#6b7280",
                                color: "white",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px"
                              }}
                            >
                              PAST
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label>Total Principal</label>
                        <div style={{ fontWeight: 600 }}>LKR {formatCurrency(day.principal)}</div>
                      </div>
                      <div>
                        <label>Allocations</label>
                        <div>{day.count}</div>
                      </div>
                      <div>
                        <label>Portfolios</label>
                        <div style={{ fontSize: "12px" }}>
                          {day.allocations
                            .map((a) => a.portfolios?.name || "Unknown")
                            .filter((v, i, arr) => arr.indexOf(v) === i)
                            .join(", ")}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {!maturityCalendar.length && (
                <div className="allocation-row">
                  <p>No upcoming maturities found.</p>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* EXCEPTIONS TAB */}
      {activeTab === "EXCEPTIONS" && (
        <>
          <section className="summary-card" style={{ marginBottom: "24px" }}>
            <div className="summary-item">
              <label>Critical Issues</label>
              <div style={{ color: "#ef4444", fontWeight: 600 }}>
                {exceptions.filter((e) => e.severity === "HIGH").length}
              </div>
            </div>
            <div className="summary-item">
              <label>Warnings</label>
              <div style={{ color: "#f59e0b", fontWeight: 600 }}>
                {exceptions.filter((e) => e.severity === "MEDIUM").length}
              </div>
            </div>
            <div className="summary-item">
              <label>Shortfalls</label>
              <div style={{ color: "#ef4444" }}>
                {exceptions.filter((e) => e.type === "SHORTFALL").length}
              </div>
            </div>
            <div className="summary-item">
              <label>Pending Collateral</label>
              <div style={{ color: "#f59e0b" }}>
                {exceptions.filter((e) => e.type === "PENDING_COLLATERAL").length}
              </div>
            </div>
            <div className="summary-item">
              <label>Total Shortfall Amount</label>
              <div>
                LKR{" "}
                {formatCurrency(
                  exceptions.reduce((sum, e) => sum + (e.shortfall || 0), 0)
                )}
              </div>
            </div>
          </section>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2>Exception Queue</h2>
              <button className="secondary" onClick={() => handleExportCsv("EXCEPTIONS")}>
                Export CSV
              </button>
            </div>

            <div className="allocations">
              {exceptions.map((exc, idx) => (
                <div
                  key={idx}
                  className="allocation-row"
                  style={{
                    borderLeft: `4px solid ${exc.severity === "HIGH" ? "#ef4444" : "#f59e0b"}`,
                    backgroundColor: exc.severity === "HIGH" ? "#fee2e2" : "#fef3c7"
                  }}
                >
                  <div className="row-grid">
                    <div>
                      <label>Type</label>
                      <div
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: exc.severity === "HIGH" ? "#ef4444" : "#f59e0b",
                          color: "white",
                          fontWeight: 600,
                          fontSize: "12px"
                        }}
                      >
                        {exc.type.replace("_", " ")}
                      </div>
                    </div>
                    <div>
                      <label>Portfolio</label>
                      <div style={{ fontWeight: 600 }}>
                        {exc.allocation.portfolios?.name || "Unknown"}
                      </div>
                    </div>
                    <div>
                      <label>Principal</label>
                      <div>LKR {formatCurrency(exc.allocation.principal)}</div>
                    </div>
                    <div>
                      <label>Maturity</label>
                      <div>{exc.allocation.repo_trades?.maturity_date || "—"}</div>
                    </div>
                    <div>
                      <label>Issue</label>
                      <div style={{ color: "#b91c1c" }}>{exc.message}</div>
                    </div>
                    {exc.shortfall && (
                      <div>
                        <label>Shortfall Amount</label>
                        <div style={{ color: "#b91c1c", fontWeight: 600 }}>
                          LKR {formatCurrency(exc.shortfall)}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="actions" style={{ marginTop: "12px" }}>
                    <a
                      href="/collateral"
                      className="nav-button"
                      style={{ fontSize: "12px" }}
                    >
                      Manage Collateral →
                    </a>
                  </div>
                </div>
              ))}

              {!exceptions.length && (
                <div
                  className="allocation-row"
                  style={{ backgroundColor: "#dcfce7", borderLeft: "4px solid #22c55e" }}
                >
                  <p style={{ color: "#166534" }}>
                    ✅ No exceptions. All allocations are properly covered.
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
