"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type OrgOption = { id: string; name: string };
type Portfolio = { id: string; name: string };
type Counterparty = { id: string; name: string };
type Security = { id: string; symbol: string; name: string | null };

type Allocation = {
  id: string;
  org_id: string;
  portfolio_id: string;
  principal: number;
  status: string;
  portfolios: { name: string } | null;
  repo_trades: {
    counterparty_id: string;
    issue_date: string;
    maturity_date: string;
    rate: number;
    day_count_basis: number;
    securities: { symbol: string | null } | null;
  } | null;
};

type CoverageRow = {
  repo_allocation_id: string;
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

type ConfigSettings = {
  coverage_method: string | null;
  coverage_buffer_pct: number | null;
};

type RepoTrade = {
  issue_date: string;
  maturity_date: string;
  rate: number;
  day_count_basis: number;
};

// Helper to compute expected interest and maturity proceeds
const computeMaturityProceeds = (
  principal: number,
  trade: RepoTrade | null
): { interest: number; proceeds: number } => {
  if (!trade || !trade.rate || !trade.issue_date || !trade.maturity_date) {
    return { interest: 0, proceeds: principal };
  }
  const days =
    (new Date(trade.maturity_date).getTime() - new Date(trade.issue_date).getTime()) /
    (1000 * 60 * 60 * 24);
  const basis = trade.day_count_basis || 365;
  const interest = principal * trade.rate * (days / basis);
  return { interest: Math.round(interest * 100) / 100, proceeds: principal + interest };
};

// Coverage status helper
const getCoverageStatus = (
  coverageBasisValue: number,
  requiredValue: number
): { status: "OK" | "WARNING" | "SHORTFALL"; ratio: number } => {
  if (requiredValue <= 0) {
    return { status: "OK", ratio: 1 };
  }
  const ratio = coverageBasisValue / requiredValue;
  if (ratio >= 1) return { status: "OK", ratio };
  if (ratio >= 0.95) return { status: "WARNING", ratio };
  return { status: "SHORTFALL", ratio };
};

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

type RolloverCollateralItem = {
  id: string;
  batch_id: string;
  collateral_mode: string;
  collateral_status: string;
  new_repo_allocation_id: string | null;
  error_message: string | null;
  portfolio: { name: string } | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 }).format(value);

const formatPct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(2)}%`;

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
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [coverageRows, setCoverageRows] = useState<CoverageRow[]>([]);
  const [collateralPositions, setCollateralPositions] = useState<CollateralPosition[]>([]);
  const [configSettings, setConfigSettings] = useState<ConfigSettings | null>(null);
  const [rolloverCollateralItems, setRolloverCollateralItems] = useState<RolloverCollateralItem[]>([]);

  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>("");
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState<string>("");
  const [selectedAllocationId, setSelectedAllocationId] = useState<string>("");

  const [collateralSecurityId, setCollateralSecurityId] = useState<string>("");
  const [faceValue, setFaceValue] = useState<string>("");
  const [dirtyPrice, setDirtyPrice] = useState<string>("");
  const [marketValue, setMarketValue] = useState<string>("");
  const [haircutPct, setHaircutPct] = useState<string>("0");
  const [valuationDate, setValuationDate] = useState<string>("");
  const [externalRef, setExternalRef] = useState<string>("");

  const [subOldCollateralId, setSubOldCollateralId] = useState<string>("");
  const [subSecurityId, setSubSecurityId] = useState<string>("");
  const [subFaceValue, setSubFaceValue] = useState<string>("");
  const [subDirtyPrice, setSubDirtyPrice] = useState<string>("");
  const [subMarketValue, setSubMarketValue] = useState<string>("");
  const [subHaircutPct, setSubHaircutPct] = useState<string>("0");
  const [subValuationDate, setSubValuationDate] = useState<string>("");
  const [subExternalRef, setSubExternalRef] = useState<string>("");
  const [subReason, setSubReason] = useState<string>("");
  const searchParams = useSearchParams();
  const allocationIdParam = searchParams.get("allocation_id");

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
      allocationRes,
      configRes,
      coverageRes,
      collateralRes,
      rolloverRes
    ] = await Promise.all([
      supabase.from("portfolios").select("id, name").eq("org_id", targetOrgId),
      supabase.from("counterparties").select("id, name").eq("org_id", targetOrgId),
      supabase
        .from("securities")
        .select("id, symbol, name, security_types ( is_repo_type )")
        .eq("org_id", targetOrgId)
        .eq("security_types.is_repo_type", false),
      supabase
        .from("repo_allocations")
        .select(
          "id, org_id, portfolio_id, principal, status, portfolios ( name ), repo_trades ( counterparty_id, issue_date, maturity_date, rate, day_count_basis, securities ( symbol ) )"
        )
        .eq("org_id", targetOrgId),
      supabase
        .from("config_settings")
        .select("coverage_method, coverage_buffer_pct")
        .eq("org_id", targetOrgId)
        .single(),
      supabase
        .from("collateral_coverage")
        .select(
          "repo_allocation_id, expected_interest, maturity_proceeds, total_market_value, total_haircut_value, required_collateral_value, coverage_basis_value, coverage_ratio, shortfall, excess"
        )
        .eq("org_id", targetOrgId),
      supabase
        .from("collateral_positions")
        .select(
          "id, repo_allocation_id, collateral_security_id, face_value, dirty_price, market_value, haircut_pct, valuation_date, status, external_custodian_ref, securities ( symbol, name )"
        )
        .eq("org_id", targetOrgId),
      supabase
        .from("rollover_batch_items")
        .select(
          "id, batch_id, collateral_mode, collateral_status, new_repo_allocation_id, error_message, portfolio:portfolios(name)"
        )
        .eq("org_id", targetOrgId)
        .in("collateral_mode", ["REPLACE", "PENDING"])
        .in("status", ["SUCCESS"])
        .order("created_at", { ascending: false })
    ]);

    if (
      portfolioRes.error ||
      counterpartyRes.error ||
      securitiesRes.error ||
      allocationRes.error ||
      coverageRes.error ||
      configRes.error ||
      collateralRes.error ||
      rolloverRes.error
    ) {
      setError(
        portfolioRes.error?.message ||
          counterpartyRes.error?.message ||
          securitiesRes.error?.message ||
          allocationRes.error?.message ||
          configRes.error?.message ||
          coverageRes.error?.message ||
          collateralRes.error?.message ||
          rolloverRes.error?.message ||
          "Failed to load collateral data."
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

    setAllocations((allocationRes.data as unknown as Allocation[]) ?? []);
    setConfigSettings((configRes.data as ConfigSettings) ?? null);
    setCoverageRows((coverageRes.data as CoverageRow[]) ?? []);
    setCollateralPositions((collateralRes.data as unknown as CollateralPosition[]) ?? []);
    setRolloverCollateralItems((rolloverRes.data as unknown as RolloverCollateralItem[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refreshData(orgId);
  }, [orgId]);

  useEffect(() => {
    if (!allocationIdParam) return;
    const exists = allocations.some((allocation) => allocation.id === allocationIdParam);
    if (exists) {
      setSelectedAllocationId(allocationIdParam);
    }
  }, [allocationIdParam, allocations]);

  const coverageMap = useMemo(() => {
    return new Map(coverageRows.map((row) => [row.repo_allocation_id, row]));
  }, [coverageRows]);

  const policyLabel = useMemo(() => {
    if (!configSettings?.coverage_method) return "Policy: Haircut value vs proceeds";
    if (configSettings.coverage_method.toUpperCase() === "BUFFER_PCT") {
      const bufferPct = ((configSettings.coverage_buffer_pct ?? 0) * 100).toFixed(2);
      return `Policy: Market value vs proceeds + ${bufferPct}% buffer`;
    }
    return "Policy: Haircut value vs proceeds";
  }, [configSettings]);

  const collateralByAllocation = useMemo(() => {
    const map = new Map<string, CollateralPosition[]>();
    collateralPositions.forEach((position) => {
      const list = map.get(position.repo_allocation_id) ?? [];
      list.push(position);
      map.set(position.repo_allocation_id, list);
    });
    return map;
  }, [collateralPositions]);

  const filteredAllocations = useMemo(() => {
    return allocations.filter((allocation) => {
      if (selectedPortfolioId && allocation.portfolio_id !== selectedPortfolioId) {
        return false;
      }
      if (
        selectedCounterpartyId &&
        allocation.repo_trades?.counterparty_id !== selectedCounterpartyId
      ) {
        return false;
      }
      return true;
    });
  }, [allocations, selectedPortfolioId, selectedCounterpartyId]);

  const selectedAllocation = allocations.find((allocation) => allocation.id === selectedAllocationId);

  const handleAddCollateral = async () => {
    if (!selectedAllocation || !collateralSecurityId) {
      setError("Select an allocation and collateral security.");
      return;
    }

    const face = Number(faceValue);
    const dirty = dirtyPrice ? Number(dirtyPrice) : null;
    const mv = Number(marketValue);
    const haircutInput = Number(haircutPct);
    if (!face || !mv || Number.isNaN(face) || Number.isNaN(mv)) {
      setError("Enter valid face value and market value.");
      return;
    }

    const valuation = valuationDate || new Date().toISOString().slice(0, 10);

    const { error: insertError } = await supabase.from("collateral_positions").insert({
      org_id: orgId,
      repo_allocation_id: selectedAllocation.id,
      portfolio_id: selectedAllocation.portfolio_id,
      collateral_security_id: collateralSecurityId,
      face_value: face,
      dirty_price: dirty,
      market_value: mv,
      haircut_pct: Number.isNaN(haircutInput) ? 0 : haircutInput / 100,
      valuation_date: valuation,
      restricted_flag: true,
      status: "RECEIVED",
      external_custodian_ref: externalRef || null
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setError(null);
    setSuccessMessage("Collateral line added.");
    setFaceValue("");
    setDirtyPrice("");
    setMarketValue("");
    setHaircutPct("0");
    setValuationDate("");
    setExternalRef("");
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

    setError(null);
    setSuccessMessage("Collateral marked as returned.");
    await refreshData(orgId);
  };

  const handleSubstitute = async () => {
    const oldCollateral = collateralPositions.find((pos) => pos.id === subOldCollateralId);
    if (!oldCollateral || !subSecurityId) {
      setError("Select a collateral line and new security.");
      return;
    }
    const allocationForOld = allocations.find(
      (allocation) => allocation.id === oldCollateral.repo_allocation_id
    );
    if (!allocationForOld) {
      setError("Unable to resolve allocation for selected collateral.");
      return;
    }

    const face = Number(subFaceValue);
    const dirty = subDirtyPrice ? Number(subDirtyPrice) : null;
    const mv = Number(subMarketValue);
    const haircutInput = Number(subHaircutPct);
    if (!face || !mv || Number.isNaN(face) || Number.isNaN(mv)) {
      setError("Enter valid face value and market value for substitution.");
      return;
    }

    const valuation = subValuationDate || new Date().toISOString().slice(0, 10);

    const { data: newCollateral, error: insertError } = await supabase
      .from("collateral_positions")
      .insert({
        org_id: orgId,
        repo_allocation_id: oldCollateral.repo_allocation_id,
        portfolio_id: allocationForOld?.portfolio_id ?? "",
        collateral_security_id: subSecurityId,
        face_value: face,
        dirty_price: dirty,
        market_value: mv,
        haircut_pct: Number.isNaN(haircutInput) ? 0 : haircutInput / 100,
        valuation_date: valuation,
        restricted_flag: true,
        status: "RECEIVED",
        external_custodian_ref: subExternalRef || null
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

    const { error: substitutionError } = await supabase.from("collateral_substitutions").insert({
      org_id: orgId,
      repo_allocation_id: oldCollateral.repo_allocation_id,
      old_collateral_id: oldCollateral.id,
      new_collateral_id: newCollateral.id,
      reason: subReason || null,
      created_by: userId
    });

    if (substitutionError) {
      setError(substitutionError.message);
      return;
    }

    setError(null);
    setSuccessMessage("Collateral substitution recorded.");
    setSubOldCollateralId("");
    setSubSecurityId("");
    setSubFaceValue("");
    setSubDirtyPrice("");
    setSubMarketValue("");
    setSubHaircutPct("0");
    setSubValuationDate("");
    setSubExternalRef("");
    setSubReason("");
    await refreshData(orgId);
  };

  const handleMarkCollateralComplete = async (itemId: string) => {
    if (!userId) {
      setError("User session not found.");
      return;
    }

    const { error: updateError } = await supabase
      .from("rollover_batch_items")
      .update({
        collateral_status: "COMPLETE",
        collateral_completed_at: new Date().toISOString(),
        collateral_completed_by: userId
      })
      .eq("id", itemId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccessMessage("Collateral marked complete.");
    await refreshData(orgId);
  };

  if (loading) {
    return (
      <main>
        <section>
          <h2>Loading collateral workspace...</h2>
          <p>Fetching allocations, collateral, and coverage.</p>
        </section>
      </main>
    );
  }

  // Auth is handled by AppShell
  if (error === "Please sign in to manage collateral.") {
    return null;
  }

  if (error) {
    return (
      <main>
        <section>
          <h2>Unable to load collateral data</h2>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <div className="badge">Collateral Monitor</div>
          <h1>Collateral Coverage & Substitutions</h1>
          <p>
            Track collateral baskets, haircut coverage, and substitution events
            for active repo allocations.
          </p>
        </div>
      </header>

      {successMessage && (
        <section className="info-banner success-banner">
          <p>✅ {successMessage}</p>
        </section>
      )}

      {/* Coverage Summary */}
      {(() => {
        const exceptions = filteredAllocations.filter((allocation) => {
          const coverage = coverageMap.get(allocation.id);
          const { proceeds } = computeMaturityProceeds(
            allocation.principal,
            allocation.repo_trades as RepoTrade | null
          );
          const requiredValue = coverage?.required_collateral_value ?? proceeds;
          const basisValue =
            coverage?.coverage_basis_value ?? coverage?.total_haircut_value ?? 0;
          const status = getCoverageStatus(basisValue, requiredValue);
          return status.status !== "OK";
        });
        const shortfalls = exceptions.filter((a) => {
          const coverage = coverageMap.get(a.id);
          const { proceeds } = computeMaturityProceeds(a.principal, a.repo_trades as RepoTrade | null);
          const requiredValue = coverage?.required_collateral_value ?? proceeds;
          const basisValue =
            coverage?.coverage_basis_value ?? coverage?.total_haircut_value ?? 0;
          return getCoverageStatus(basisValue, requiredValue).status === "SHORTFALL";
        });
        const totalRequired = filteredAllocations.reduce((sum, allocation) => {
          const coverage = coverageMap.get(allocation.id);
          const { proceeds } = computeMaturityProceeds(
            allocation.principal,
            allocation.repo_trades as RepoTrade | null
          );
          return sum + (coverage?.required_collateral_value ?? proceeds);
        }, 0);

        return (
          <section className="summary-card" style={{ marginBottom: "24px" }}>
            <div className="summary-item">
              <label>Total Allocations</label>
              <div>{filteredAllocations.length}</div>
            </div>
            <div className="summary-item">
              <label>Fully Covered</label>
              <div style={{ color: "#22c55e", fontWeight: 600 }}>
                {filteredAllocations.length - exceptions.length}
              </div>
            </div>
            <div className="summary-item">
              <label>Warnings</label>
              <div style={{ color: "#f59e0b", fontWeight: 600 }}>
                {exceptions.length - shortfalls.length}
              </div>
            </div>
            <div className="summary-item">
              <label>Shortfalls</label>
              <div style={{ color: "#ef4444", fontWeight: 600 }}>
                {shortfalls.length}
              </div>
            </div>
            <div className="summary-item">
              <label>Total Principal</label>
              <div>LKR {formatCurrency(filteredAllocations.reduce((sum, a) => sum + a.principal, 0))}</div>
            </div>
            <div className="summary-item">
              <label>Total Required</label>
              <div>LKR {formatCurrency(totalRequired)}</div>
            </div>
            <div className="summary-item">
              <label>Total Collateral (Basis)</label>
              <div>
                LKR {formatCurrency(
                  filteredAllocations.reduce(
                    (sum, a) =>
                      sum +
                      (coverageMap.get(a.id)?.coverage_basis_value ??
                        coverageMap.get(a.id)?.total_haircut_value ??
                        0),
                    0
                  )
                )}
              </div>
            </div>
          </section>
        );
      })()}

      <section>
        <h2>Coverage Monitor</h2>
        <p className="footer-note">{policyLabel}</p>
        <div className="section-grid">
          {orgOptions.length > 1 && (
            <div>
              <label>Organization</label>
              <select
                value={orgId}
                onChange={(event) => setOrgId(event.target.value)}
              >
                {orgOptions.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label>Portfolio</label>
            <select
              value={selectedPortfolioId}
              onChange={(event) => setSelectedPortfolioId(event.target.value)}
            >
              <option value="">All portfolios</option>
              {portfolios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Counterparty</label>
            <select
              value={selectedCounterpartyId}
              onChange={(event) => setSelectedCounterpartyId(event.target.value)}
            >
              <option value="">All counterparties</option>
              {counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="allocations">
          {filteredAllocations.map((allocation) => {
            const coverage = coverageMap.get(allocation.id);
            const { interest, proceeds } = computeMaturityProceeds(
              allocation.principal,
              allocation.repo_trades as RepoTrade | null
            );
            const expectedInterest = coverage?.expected_interest ?? interest;
            const maturityProceeds = coverage?.maturity_proceeds ?? proceeds;
            const requiredValue = coverage?.required_collateral_value ?? maturityProceeds;
            const basisValue =
              coverage?.coverage_basis_value ?? coverage?.total_haircut_value ?? 0;
            const coverageStatus = getCoverageStatus(
              basisValue,
              requiredValue
            );
            const statusColors = {
              OK: { bg: "#dcfce7", border: "#22c55e", text: "#166534" },
              WARNING: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
              SHORTFALL: { bg: "#fee2e2", border: "#ef4444", text: "#b91c1c" }
            };
            const colors = statusColors[coverageStatus.status];

            return (
              <div
                key={allocation.id}
                className="allocation-row"
                style={{
                  borderLeft: `4px solid ${colors.border}`,
                  backgroundColor: coverageStatus.status !== "OK" ? colors.bg : undefined
                }}
              >
                <div className="row-grid">
                  <div>
                    <label>Portfolio</label>
                    <div>{allocation.portfolios?.name ?? allocation.portfolio_id}</div>
                  </div>
                  <div>
                    <label>Repo Security</label>
                    <div>{allocation.repo_trades?.securities?.symbol ?? "—"}</div>
                  </div>
                  <div>
                    <label>Principal</label>
                    <div>LKR {formatCurrency(allocation.principal)}</div>
                  </div>
                  <div>
                    <label>Interest</label>
                    <div>LKR {formatCurrency(expectedInterest)}</div>
                  </div>
                  <div>
                    <label>Maturity Proceeds</label>
                    <div style={{ fontWeight: 600 }}>LKR {formatCurrency(maturityProceeds)}</div>
                  </div>
                  <div>
                    <label>Required Collateral</label>
                    <div>LKR {formatCurrency(requiredValue)}</div>
                  </div>
                  <div>
                    <label>Collateral (Basis)</label>
                    <div>LKR {formatCurrency(basisValue)}</div>
                  </div>
                  <div>
                    <label>Coverage vs Required</label>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        backgroundColor: colors.border,
                        color: "white",
                        fontWeight: 600,
                        fontSize: "12px"
                      }}
                    >
                      {(coverageStatus.ratio * 100).toFixed(1)}%
                      {coverageStatus.status === "SHORTFALL" && " ⚠️"}
                      {coverageStatus.status === "WARNING" && " ⚡"}
                    </div>
                  </div>
                  <div>
                    <label>Shortfall</label>
                    <div style={{ color: coverageStatus.status === "SHORTFALL" ? colors.text : undefined }}>
                      LKR {formatCurrency(coverage?.shortfall ?? Math.max(requiredValue - basisValue, 0))}
                    </div>
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => setSelectedAllocationId(allocation.id)}
                  >
                    Manage Collateral
                  </button>
                </div>
              </div>
            );
          })}
          {!filteredAllocations.length && (
            <div className="allocation-row">
              <p>No allocations match the selected filters.</p>
            </div>
          )}
        </div>
      </section>

      <section style={{ marginTop: "24px" }}>
        <h2>Rollover Collateral Queue</h2>
        <p className="footer-note">
          Items from rollover batches that require collateral capture or confirmation.
        </p>
        {rolloverCollateralItems.length === 0 ? (
          <div className="allocation-row">
            <p>No rollover collateral actions pending.</p>
          </div>
        ) : (
          <div className="allocations">
            {rolloverCollateralItems.map((item) => (
              <div key={item.id} className="allocation-row">
                <div className="row-grid">
                  <div>
                    <label>Portfolio</label>
                    <div>{item.portfolio?.name ?? "Portfolio"}</div>
                  </div>
                  <div>
                    <label>Mode</label>
                    <div>{item.collateral_mode}</div>
                  </div>
                  <div>
                    <label>Status</label>
                    <div>{item.collateral_status}</div>
                  </div>
                  <div>
                    <label>Note</label>
                    <div>{item.error_message ?? "—"}</div>
                  </div>
                </div>
                <div className="actions">
                  {item.new_repo_allocation_id ? (
                    <button
                      className="secondary"
                      onClick={() => setSelectedAllocationId(item.new_repo_allocation_id ?? "")}
                    >
                      Select Allocation
                    </button>
                  ) : null}
                  <button
                    className="primary"
                    onClick={() => handleMarkCollateralComplete(item.id)}
                    disabled={item.collateral_status === "COMPLETE"}
                  >
                    {item.collateral_status === "COMPLETE" ? "Completed" : "Mark Complete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: "24px" }}>
        <h2>Add Collateral Line</h2>
        <div className="section-grid">
          <div>
            <label>Repo Allocation</label>
            <select
              value={selectedAllocationId}
              onChange={(event) => setSelectedAllocationId(event.target.value)}
            >
              <option value="">Select allocation</option>
              {allocations.map((allocation) => (
                <option key={allocation.id} value={allocation.id}>
                  {allocation.portfolios?.name ?? allocation.portfolio_id} •{" "}
                  {allocation.repo_trades?.securities?.symbol ?? "Repo"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Collateral Security</label>
            <select
              value={collateralSecurityId}
              onChange={(event) => setCollateralSecurityId(event.target.value)}
            >
              <option value="">Select security</option>
              {collateralSecurities.map((security) => (
                <option key={security.id} value={security.id}>
                  {security.symbol} {security.name ? `• ${security.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Face Value</label>
            <input
              type="number"
              value={faceValue}
              onChange={(event) => setFaceValue(event.target.value)}
              min="0"
            />
          </div>
          <div>
            <label>Dirty Price</label>
            <input
              type="number"
              value={dirtyPrice}
              onChange={(event) => setDirtyPrice(event.target.value)}
              min="0"
              step="0.0001"
            />
          </div>
          <div>
            <label>Market Value</label>
            <input
              type="number"
              value={marketValue}
              onChange={(event) => setMarketValue(event.target.value)}
              min="0"
            />
          </div>
          <div>
            <label>Haircut %</label>
            <input
              type="number"
              value={haircutPct}
              onChange={(event) => setHaircutPct(event.target.value)}
              min="0"
              step="0.0001"
            />
          </div>
          <div>
            <label>Valuation Date</label>
            <input
              type="date"
              value={valuationDate}
              onChange={(event) => setValuationDate(event.target.value)}
            />
          </div>
          <div>
            <label>External Custodian Ref</label>
            <input
              value={externalRef}
              onChange={(event) => setExternalRef(event.target.value)}
            />
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={handleAddCollateral}>
            Add Collateral
          </button>
        </div>

        {selectedAllocation && (
          <div className="allocations" style={{ marginTop: "16px" }}>
            {(collateralByAllocation.get(selectedAllocation.id) ?? []).map((item) => (
              <div key={item.id} className="allocation-row">
                <div className="row-grid">
                  <div>
                    <label>Security</label>
                    <div>{item.securities?.symbol ?? item.collateral_security_id}</div>
                  </div>
                  <div>
                    <label>Market Value</label>
                    <div>LKR {formatCurrency(item.market_value)}</div>
                  </div>
                  <div>
                    <label>Haircut</label>
                    <div>{formatPct(item.haircut_pct)}</div>
                  </div>
                  <div>
                    <label>Status</label>
                    <div>{item.status}</div>
                  </div>
                  <div>
                    <label>Valuation</label>
                    <div>{item.valuation_date}</div>
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => setSubOldCollateralId(item.id)}
                  >
                    Substitute
                  </button>
                  <button
                    className="ghost"
                    onClick={() => handleMarkReturned(item.id)}
                  >
                    Mark Returned
                  </button>
                </div>
              </div>
            ))}
            {!(collateralByAllocation.get(selectedAllocation.id) ?? []).length && (
              <div className="allocation-row">
                <p>No collateral lines captured yet.</p>
              </div>
            )}
          </div>
        )}
      </section>

      <section style={{ marginTop: "24px" }}>
        <h2>Collateral Substitution</h2>
        <div className="section-grid">
          <div>
            <label>Existing Collateral</label>
            <select
              value={subOldCollateralId}
              onChange={(event) => setSubOldCollateralId(event.target.value)}
            >
              <option value="">Select collateral line</option>
              {collateralPositions
                .filter((item) => item.status === "RECEIVED" || item.status === "ACTIVE")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.securities?.symbol ?? item.collateral_security_id} •{" "}
                    {item.valuation_date}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label>New Security</label>
            <select
              value={subSecurityId}
              onChange={(event) => setSubSecurityId(event.target.value)}
            >
              <option value="">Select security</option>
              {collateralSecurities.map((security) => (
                <option key={security.id} value={security.id}>
                  {security.symbol} {security.name ? `• ${security.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>New Face Value</label>
            <input
              type="number"
              value={subFaceValue}
              onChange={(event) => setSubFaceValue(event.target.value)}
              min="0"
            />
          </div>
          <div>
            <label>New Dirty Price</label>
            <input
              type="number"
              value={subDirtyPrice}
              onChange={(event) => setSubDirtyPrice(event.target.value)}
              min="0"
              step="0.0001"
            />
          </div>
          <div>
            <label>New Market Value</label>
            <input
              type="number"
              value={subMarketValue}
              onChange={(event) => setSubMarketValue(event.target.value)}
              min="0"
            />
          </div>
          <div>
            <label>New Haircut %</label>
            <input
              type="number"
              value={subHaircutPct}
              onChange={(event) => setSubHaircutPct(event.target.value)}
              min="0"
              step="0.0001"
            />
          </div>
          <div>
            <label>New Valuation Date</label>
            <input
              type="date"
              value={subValuationDate}
              onChange={(event) => setSubValuationDate(event.target.value)}
            />
          </div>
          <div>
            <label>New External Ref</label>
            <input
              value={subExternalRef}
              onChange={(event) => setSubExternalRef(event.target.value)}
            />
          </div>
          <div>
            <label>Reason</label>
            <input
              value={subReason}
              onChange={(event) => setSubReason(event.target.value)}
            />
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={handleSubstitute}>
            Record Substitution
          </button>
        </div>
        {successMessage && <p className="footer-note">{successMessage}</p>}
      </section>

      {/* Exceptions Queue */}
      <section style={{ marginTop: "24px" }}>
        <h2>⚠️ Exceptions Queue</h2>
        <p style={{ marginBottom: "16px", color: "#666" }}>
          Allocations with coverage warnings or shortfalls that require attention.
        </p>
        <div className="allocations">
          {filteredAllocations
            .filter((allocation) => {
              const coverage = coverageMap.get(allocation.id);
              const { proceeds } = computeMaturityProceeds(
                allocation.principal,
                allocation.repo_trades as RepoTrade | null
              );
              const requiredValue = coverage?.required_collateral_value ?? proceeds;
              const basisValue =
                coverage?.coverage_basis_value ?? coverage?.total_haircut_value ?? 0;
              return getCoverageStatus(basisValue, requiredValue).status !== "OK";
            })
            .map((allocation) => {
              const coverage = coverageMap.get(allocation.id);
              const { interest, proceeds } = computeMaturityProceeds(
                allocation.principal,
                allocation.repo_trades as RepoTrade | null
              );
              const expectedInterest = coverage?.expected_interest ?? interest;
              const maturityProceeds = coverage?.maturity_proceeds ?? proceeds;
              const requiredValue = coverage?.required_collateral_value ?? maturityProceeds;
              const basisValue =
                coverage?.coverage_basis_value ?? coverage?.total_haircut_value ?? 0;
              const coverageStatus = getCoverageStatus(
                basisValue,
                requiredValue
              );
              const shortfallAmount =
                coverage?.shortfall ?? Math.max(requiredValue - basisValue, 0);

              return (
                <div
                  key={allocation.id}
                  className="allocation-row"
                  style={{
                    borderLeft: `4px solid ${coverageStatus.status === "SHORTFALL" ? "#ef4444" : "#f59e0b"}`,
                    backgroundColor: coverageStatus.status === "SHORTFALL" ? "#fee2e2" : "#fef3c7"
                  }}
                >
                  <div className="row-grid">
                    <div>
                      <label>Portfolio</label>
                      <div style={{ fontWeight: 600 }}>{allocation.portfolios?.name ?? allocation.portfolio_id}</div>
                    </div>
                    <div>
                      <label>Repo</label>
                      <div>{allocation.repo_trades?.securities?.symbol ?? "—"}</div>
                    </div>
                    <div>
                      <label>Maturity</label>
                      <div>{allocation.repo_trades?.maturity_date ?? "—"}</div>
                    </div>
                    <div>
                      <label>Proceeds Required</label>
                      <div>LKR {formatCurrency(maturityProceeds)}</div>
                    </div>
                    <div>
                      <label>Collateral Available</label>
                      <div>LKR {formatCurrency(basisValue)}</div>
                    </div>
                    <div>
                      <label>Shortfall</label>
                      <div style={{ color: "#b91c1c", fontWeight: 600 }}>
                        LKR {formatCurrency(shortfallAmount)}
                      </div>
                    </div>
                    <div>
                      <label>Status</label>
                      <div
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: coverageStatus.status === "SHORTFALL" ? "#ef4444" : "#f59e0b",
                          color: "white",
                          fontWeight: 600,
                          fontSize: "12px"
                        }}
                      >
                        {coverageStatus.status === "SHORTFALL" ? "🚨 SHORTFALL" : "⚡ WARNING"}
                      </div>
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="primary"
                      onClick={() => setSelectedAllocationId(allocation.id)}
                    >
                      Add Collateral
                    </button>
                  </div>
                </div>
              );
            })}
          {filteredAllocations.every((allocation) => {
            const coverage = coverageMap.get(allocation.id);
            const { proceeds } = computeMaturityProceeds(
              allocation.principal,
              allocation.repo_trades as RepoTrade | null
            );
            const requiredValue = coverage?.required_collateral_value ?? proceeds;
            const basisValue =
              coverage?.coverage_basis_value ?? coverage?.total_haircut_value ?? 0;
            return getCoverageStatus(basisValue, requiredValue).status === "OK";
          }) && (
            <div className="allocation-row" style={{ backgroundColor: "#dcfce7", borderLeft: "4px solid #22c55e" }}>
              <p style={{ color: "#166534" }}>✅ All allocations are fully covered. No exceptions.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
