"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrgOption = { id: string; name: string };
type UserRole = "FO_TRADER" | "BO_OPERATIONS" | "RISK_COMPLIANCE" | "OPS_SUPERVISOR" | "READ_ONLY";
type SecurityStatus = "UNSUPERVISED" | "PENDING_BO_APPROVAL" | "APPROVED" | "INACTIVE";

type SecurityType = {
  id: string;
  code: string;
  name: string;
  is_repo_type: boolean;
};

type Counterparty = {
  id: string;
  name: string;
  short_code: string;
};

type Security = {
  id: string;
  org_id: string;
  symbol: string;
  name: string;
  isin: string | null;
  issuer: string | null;
  issue_date: string | null;
  maturity_date: string | null;
  rate: number | null;
  day_count_basis: number | null;
  status: SecurityStatus;
  created_at: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  security_type_id: string;
  counterparty_id: string | null;
  security_types: { code: string; name: string; is_repo_type: boolean } | null;
  counterparties: { name: string; short_code: string } | null;
};

const STATUS_COLORS: Record<SecurityStatus, string> = {
  UNSUPERVISED: "#f59e0b",
  PENDING_BO_APPROVAL: "#3b82f6",
  APPROVED: "#22c55e",
  INACTIVE: "#6b7280"
};

const STATUS_LABELS: Record<SecurityStatus, string> = {
  UNSUPERVISED: "Unsupervised",
  PENDING_BO_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  INACTIVE: "Inactive"
};

export default function SecuritiesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  const [securities, setSecurities] = useState<Security[]>([]);
  const [securityTypes, setSecurityTypes] = useState<SecurityType[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);

  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [selectedSecurityId, setSelectedSecurityId] = useState<string>("");

  // New security form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  const [newIsin, setNewIsin] = useState("");
  const [newIssuer, setNewIssuer] = useState("");
  const [newSecurityTypeId, setNewSecurityTypeId] = useState("");
  const [newCounterpartyId, setNewCounterpartyId] = useState("");
  const [newIssueDate, setNewIssueDate] = useState("");
  const [newMaturityDate, setNewMaturityDate] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newDayCountBasis, setNewDayCountBasis] = useState("365");

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to manage securities.");
        setLoading(false);
        return;
      }
      setUserId(authData.user.id);

      const { data: memberData, error: memberError } = await supabase
        .from("org_members")
        .select("org_id, role, orgs ( id, name )")
        .eq("user_id", authData.user.id);

      if (memberError) {
        setError(memberError.message);
        setLoading(false);
        return;
      }

      const orgs: OrgOption[] =
        (memberData as Array<{ org_id: string; role: UserRole; orgs?: { id?: string; name?: string } | null }>)
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

      const role = (memberData as Array<{ role: UserRole }>)?.[0]?.role ?? null;
      setUserRole(role);
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

    const [securitiesRes, typesRes, counterpartiesRes, roleRes] = await Promise.all([
      supabase
        .from("securities")
        .select(
          "id, org_id, symbol, name, isin, issuer, issue_date, maturity_date, rate, day_count_basis, status, created_at, created_by, approved_by, approved_at, security_type_id, counterparty_id, security_types ( code, name, is_repo_type ), counterparties ( name, short_code )"
        )
        .eq("org_id", targetOrgId)
        .order("created_at", { ascending: false }),
      supabase
        .from("security_types")
        .select("id, code, name, is_repo_type")
        .eq("org_id", targetOrgId),
      supabase
        .from("counterparties")
        .select("id, name, short_code")
        .eq("org_id", targetOrgId),
      userId
        ? supabase
            .from("org_members")
            .select("role")
            .eq("org_id", targetOrgId)
            .eq("user_id", userId)
            .single()
        : Promise.resolve({ data: null, error: null })
    ]);

    if (securitiesRes.error || typesRes.error || counterpartiesRes.error) {
      setError(
        securitiesRes.error?.message ||
          typesRes.error?.message ||
          counterpartiesRes.error?.message ||
          "Failed to load data."
      );
      setLoading(false);
      return;
    }

    setSecurities((securitiesRes.data as unknown as Security[]) ?? []);
    setSecurityTypes((typesRes.data as SecurityType[]) ?? []);
    setCounterparties((counterpartiesRes.data as Counterparty[]) ?? []);
    setUserRole((roleRes.data?.role as UserRole) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (orgId && userId) {
      refreshData(orgId);
    }
  }, [orgId, userId]);

  const canApprove = userRole === "BO_OPERATIONS" || userRole === "OPS_SUPERVISOR";
  const canCreate = userRole !== "READ_ONLY";

  const filteredSecurities = useMemo(() => {
    return securities.filter((sec) => {
      if (filterStatus !== "ALL" && sec.status !== filterStatus) return false;
      if (filterType !== "ALL" && sec.security_type_id !== filterType) return false;
      return true;
    });
  }, [securities, filterStatus, filterType]);

  const pendingCount = securities.filter(
    (s) => s.status === "UNSUPERVISED" || s.status === "PENDING_BO_APPROVAL"
  ).length;

  const selectedSecurity = securities.find((s) => s.id === selectedSecurityId);

  const handleApprove = async (securityId: string) => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const { error: updateError } = await supabase
      .from("securities")
      .update({
        status: "APPROVED",
        approved_by: userId,
        approved_at: new Date().toISOString()
      })
      .eq("id", securityId);

    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccessMessage("Security approved successfully.");
    await refreshData(orgId);
  };

  const handleSubmitForApproval = async (securityId: string) => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const { error: updateError } = await supabase
      .from("securities")
      .update({ status: "PENDING_BO_APPROVAL" })
      .eq("id", securityId);

    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccessMessage("Security submitted for BO approval.");
    await refreshData(orgId);
  };

  const handleReject = async (securityId: string) => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const { error: updateError } = await supabase
      .from("securities")
      .update({ status: "UNSUPERVISED" })
      .eq("id", securityId);

    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccessMessage("Security returned to unsupervised status.");
    await refreshData(orgId);
  };

  const handleDeactivate = async (securityId: string) => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const { error: updateError } = await supabase
      .from("securities")
      .update({ status: "INACTIVE" })
      .eq("id", securityId);

    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccessMessage("Security deactivated.");
    await refreshData(orgId);
  };

  const handleCreateSecurity = async () => {
    if (!newSymbol || !newName || !newSecurityTypeId) {
      setError("Symbol, name, and security type are required.");
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const { error: insertError } = await supabase.from("securities").insert({
      org_id: orgId,
      symbol: newSymbol,
      name: newName,
      isin: newIsin || null,
      issuer: newIssuer || null,
      security_type_id: newSecurityTypeId,
      counterparty_id: newCounterpartyId || null,
      issue_date: newIssueDate || null,
      maturity_date: newMaturityDate || null,
      rate: newRate ? Number(newRate) / 100 : null,
      day_count_basis: newDayCountBasis ? Number(newDayCountBasis) : null,
      status: "UNSUPERVISED",
      created_by: userId
    });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSuccessMessage("Security created successfully.");
    setShowNewForm(false);
    setNewSymbol("");
    setNewName("");
    setNewIsin("");
    setNewIssuer("");
    setNewSecurityTypeId("");
    setNewCounterpartyId("");
    setNewIssueDate("");
    setNewMaturityDate("");
    setNewRate("");
    setNewDayCountBasis("365");
    await refreshData(orgId);
  };

  if (loading) {
    return (
      <main>
        <section>
          <h2>Loading securities...</h2>
        </section>
      </main>
    );
  }

  // Auth is handled by AppShell
  if (error === "Please sign in to manage securities.") {
    return null;
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div className="badge">Security Master</div>
            {canApprove && (
              <div className="badge badge-bo">BO Approval Access</div>
            )}
            {pendingCount > 0 && (
              <div className="badge" style={{ backgroundColor: "#f59e0b", color: "white" }}>
                {pendingCount} Pending
              </div>
            )}
          </div>
          <h1>Security Approval & Management</h1>
          <p>
            Create, review, and approve securities. Only BO can approve securities
            before they can be used in repo trades.
          </p>
        </div>
      </header>

      {error && (
        <section className="info-banner" style={{ backgroundColor: "#fee2e2", borderColor: "#ef4444" }}>
          <p style={{ color: "#b91c1c" }}>❌ {error}</p>
        </section>
      )}

      {successMessage && (
        <section className="info-banner success-banner">
          <p>✅ {successMessage}</p>
        </section>
      )}

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2>Securities</h2>
          {canCreate && (
            <button className="primary" onClick={() => setShowNewForm(!showNewForm)}>
              {showNewForm ? "Cancel" : "+ New Security"}
            </button>
          )}
        </div>

        {showNewForm && (
          <div className="form-card" style={{ marginBottom: "24px" }}>
            <h3>Create New Security</h3>
            <div className="section-grid">
              <div>
                <label>Symbol *</label>
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  placeholder="e.g., BOC-REPO-2025-01-02"
                />
              </div>
              <div>
                <label>Name *</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., BOC Repo 3D @ 8.5%"
                />
              </div>
              <div>
                <label>Security Type *</label>
                <select
                  value={newSecurityTypeId}
                  onChange={(e) => setNewSecurityTypeId(e.target.value)}
                >
                  <option value="">Select type</option>
                  {securityTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name} ({type.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Counterparty</label>
                <select
                  value={newCounterpartyId}
                  onChange={(e) => setNewCounterpartyId(e.target.value)}
                >
                  <option value="">Select counterparty</option>
                  {counterparties.map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.name} ({cp.short_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>ISIN</label>
                <input
                  value={newIsin}
                  onChange={(e) => setNewIsin(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label>Issuer</label>
                <input
                  value={newIssuer}
                  onChange={(e) => setNewIssuer(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label>Issue Date</label>
                <input
                  type="date"
                  value={newIssueDate}
                  onChange={(e) => setNewIssueDate(e.target.value)}
                />
              </div>
              <div>
                <label>Maturity Date</label>
                <input
                  type="date"
                  value={newMaturityDate}
                  onChange={(e) => setNewMaturityDate(e.target.value)}
                />
              </div>
              <div>
                <label>Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  placeholder="e.g., 8.5"
                />
              </div>
              <div>
                <label>Day Count Basis</label>
                <select
                  value={newDayCountBasis}
                  onChange={(e) => setNewDayCountBasis(e.target.value)}
                >
                  <option value="365">365</option>
                  <option value="360">360</option>
                </select>
              </div>
            </div>
            <div className="actions" style={{ marginTop: "16px" }}>
              <button
                className="primary"
                onClick={handleCreateSecurity}
                disabled={submitting}
              >
                {submitting ? "Creating..." : "Create Security"}
              </button>
            </div>
          </div>
        )}

        <div className="section-grid" style={{ marginBottom: "16px" }}>
          {orgOptions.length > 1 && (
            <div>
              <label>Organization</label>
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
              >
                {orgOptions.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label>Status Filter</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="UNSUPERVISED">Unsupervised</option>
              <option value="PENDING_BO_APPROVAL">Pending Approval</option>
              <option value="APPROVED">Approved</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <div>
            <label>Type Filter</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="ALL">All Types</option>
              {securityTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="allocations">
          {filteredSecurities.map((sec) => (
            <div
              key={sec.id}
              className={`allocation-row ${selectedSecurityId === sec.id ? "selected" : ""}`}
              onClick={() => setSelectedSecurityId(sec.id === selectedSecurityId ? "" : sec.id)}
              style={{ cursor: "pointer" }}
            >
              <div className="row-grid">
                <div>
                  <label>Symbol</label>
                  <div style={{ fontWeight: 600 }}>{sec.symbol}</div>
                </div>
                <div>
                  <label>Name</label>
                  <div>{sec.name}</div>
                </div>
                <div>
                  <label>Type</label>
                  <div>
                    {sec.security_types?.name ?? "—"}
                    {sec.security_types?.is_repo_type && (
                      <span style={{ marginLeft: "4px", fontSize: "10px", backgroundColor: "#ddd5f3", padding: "2px 6px", borderRadius: "4px" }}>REPO</span>
                    )}
                  </div>
                </div>
                <div>
                  <label>Rate</label>
                  <div>{sec.rate ? `${(sec.rate * 100).toFixed(2)}%` : "—"}</div>
                </div>
                <div>
                  <label>Maturity</label>
                  <div>{sec.maturity_date ?? "—"}</div>
                </div>
                <div>
                  <label>Status</label>
                  <div
                    style={{
                      display: "inline-block",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      backgroundColor: STATUS_COLORS[sec.status],
                      color: "white",
                      fontSize: "12px",
                      fontWeight: 600
                    }}
                  >
                    {STATUS_LABELS[sec.status]}
                  </div>
                </div>
              </div>

              {selectedSecurityId === sec.id && (
                <div className="detail-panel" style={{ marginTop: "16px", padding: "16px", backgroundColor: "rgba(0,0,0,0.02)", borderRadius: "8px" }}>
                  <div className="row-grid" style={{ marginBottom: "16px" }}>
                    <div>
                      <label>ISIN</label>
                      <div>{sec.isin || "—"}</div>
                    </div>
                    <div>
                      <label>Issuer</label>
                      <div>{sec.issuer || "—"}</div>
                    </div>
                    <div>
                      <label>Counterparty</label>
                      <div>{sec.counterparties?.name || "—"}</div>
                    </div>
                    <div>
                      <label>Issue Date</label>
                      <div>{sec.issue_date || "—"}</div>
                    </div>
                    <div>
                      <label>Day Count</label>
                      <div>{sec.day_count_basis || "—"}</div>
                    </div>
                    <div>
                      <label>Created</label>
                      <div>{new Date(sec.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>

                  <div className="actions">
                    {sec.status === "UNSUPERVISED" && canCreate && !canApprove && (
                      <button
                        className="primary"
                        onClick={(e) => { e.stopPropagation(); handleSubmitForApproval(sec.id); }}
                        disabled={submitting}
                      >
                        Submit for Approval
                      </button>
                    )}

                    {(sec.status === "UNSUPERVISED" || sec.status === "PENDING_BO_APPROVAL") && canApprove && (
                      <>
                        {sec.created_by !== userId ? (
                          <button
                            className="primary"
                            onClick={(e) => { e.stopPropagation(); handleApprove(sec.id); }}
                            disabled={submitting}
                          >
                            ✓ Approve
                          </button>
                        ) : (
                          <span style={{ color: "#f59e0b", fontSize: "12px" }}>
                            ⚠️ Cannot approve own security
                          </span>
                        )}
                        <button
                          className="ghost"
                          onClick={(e) => { e.stopPropagation(); handleReject(sec.id); }}
                          disabled={submitting}
                        >
                          Return to Unsupervised
                        </button>
                      </>
                    )}

                    {sec.status === "APPROVED" && canApprove && (
                      <button
                        className="ghost"
                        onClick={(e) => { e.stopPropagation(); handleDeactivate(sec.id); }}
                        disabled={submitting}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {!filteredSecurities.length && (
            <div className="allocation-row">
              <p>No securities match the selected filters.</p>
            </div>
          )}
        </div>
      </section>

      {canApprove && (
        <section style={{ marginTop: "24px" }}>
          <h2>Approval Queue Summary</h2>
          <div className="summary-card">
            <div className="summary-item">
              <label>Unsupervised</label>
              <div style={{ color: STATUS_COLORS.UNSUPERVISED, fontWeight: 600 }}>
                {securities.filter((s) => s.status === "UNSUPERVISED").length}
              </div>
            </div>
            <div className="summary-item">
              <label>Pending Approval</label>
              <div style={{ color: STATUS_COLORS.PENDING_BO_APPROVAL, fontWeight: 600 }}>
                {securities.filter((s) => s.status === "PENDING_BO_APPROVAL").length}
              </div>
            </div>
            <div className="summary-item">
              <label>Approved</label>
              <div style={{ color: STATUS_COLORS.APPROVED, fontWeight: 600 }}>
                {securities.filter((s) => s.status === "APPROVED").length}
              </div>
            </div>
            <div className="summary-item">
              <label>Inactive</label>
              <div style={{ color: STATUS_COLORS.INACTIVE, fontWeight: 600 }}>
                {securities.filter((s) => s.status === "INACTIVE").length}
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

