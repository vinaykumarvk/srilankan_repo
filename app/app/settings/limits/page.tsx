"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Counterparty = { id: string; name: string; short_code: string };
type CounterpartyLimit = {
  id: string;
  counterparty_id: string;
  counterparty_name?: string;
  counterparty_code?: string;
  limit_type: string;
  limit_amount: number;
  warning_threshold_pct: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
};

type ExposureData = {
  counterparty_id: string;
  counterparty_name: string;
  short_code: string;
  total_principal_exposure: number;
  exposure_limit: number;
  utilization_pct: number | null;
  limit_status: string;
  warning_threshold_pct: number | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export default function CounterpartyLimitsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string>("");
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [limits, setLimits] = useState<CounterpartyLimit[]>([]);
  const [exposures, setExposures] = useState<ExposureData[]>([]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState("");
  const [limitAmount, setLimitAmount] = useState("");
  const [warningThreshold, setWarningThreshold] = useState("80");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLimitAmount, setEditLimitAmount] = useState("");
  const [editWarningThreshold, setEditWarningThreshold] = useState("");

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to manage counterparty limits.");
        setLoading(false);
        return;
      }

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
    };

    init();
  }, []);

  useEffect(() => {
    if (!orgId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const [counterpartiesRes, limitsRes, exposuresRes] = await Promise.all([
        supabase
          .from("counterparties")
          .select("id, name, short_code")
          .eq("org_id", orgId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("counterparty_limits")
          .select("id, counterparty_id, limit_type, limit_amount, warning_threshold_pct, is_active, effective_from, effective_to, counterparties ( name, short_code )")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false }),
        supabase
          .from("counterparty_exposure")
          .select("*")
          .eq("org_id", orgId)
      ]);

      if (counterpartiesRes.error) {
        setError(counterpartiesRes.error.message);
        setLoading(false);
        return;
      }

      setCounterparties(counterpartiesRes.data ?? []);

      const limitsWithNames = (limitsRes.data ?? []).map((l: unknown) => {
        const limit = l as CounterpartyLimit & { counterparties?: { name?: string; short_code?: string } | null };
        return {
          ...limit,
          counterparty_name: limit.counterparties?.name,
          counterparty_code: limit.counterparties?.short_code
        };
      });
      setLimits(limitsWithNames);

      setExposures((exposuresRes.data as unknown as ExposureData[]) ?? []);
      setLoading(false);
    };

    loadData();
  }, [orgId]);

  const handleAddLimit = async () => {
    if (!selectedCounterpartyId || !limitAmount) {
      setError("Please select a counterparty and enter a limit amount.");
      return;
    }

    setSaving(true);
    setError(null);

    const { data, error: insertError } = await supabase
      .from("counterparty_limits")
      .insert({
        org_id: orgId,
        counterparty_id: selectedCounterpartyId,
        limit_type: "TOTAL_EXPOSURE",
        limit_amount: parseFloat(limitAmount),
        warning_threshold_pct: parseFloat(warningThreshold),
        effective_from: effectiveFrom,
        is_active: true
      })
      .select("id, counterparty_id, limit_type, limit_amount, warning_threshold_pct, is_active, effective_from, effective_to, counterparties ( name, short_code )")
      .single();

    if (insertError) {
      if (insertError.message.includes("duplicate")) {
        setError("A limit already exists for this counterparty. Edit the existing limit instead.");
      } else {
        setError(insertError.message);
      }
      setSaving(false);
      return;
    }

    const newLimit = {
      ...data,
      counterparty_name: (data as { counterparties?: { name?: string; short_code?: string } | null }).counterparties?.name,
      counterparty_code: (data as { counterparties?: { name?: string; short_code?: string } | null }).counterparties?.short_code
    };

    setLimits((prev) => [newLimit as CounterpartyLimit, ...prev]);
    setShowAddForm(false);
    setSelectedCounterpartyId("");
    setLimitAmount("");
    setWarningThreshold("80");
    setSuccessMessage("Limit added successfully.");
    setSaving(false);

    // Reload exposures
    const { data: expData } = await supabase.from("counterparty_exposure").select("*").eq("org_id", orgId);
    setExposures((expData as unknown as ExposureData[]) ?? []);
  };

  const handleUpdateLimit = async (limitId: string) => {
    setSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("counterparty_limits")
      .update({
        limit_amount: parseFloat(editLimitAmount),
        warning_threshold_pct: parseFloat(editWarningThreshold)
      })
      .eq("id", limitId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setLimits((prev) =>
      prev.map((l) =>
        l.id === limitId
          ? { ...l, limit_amount: parseFloat(editLimitAmount), warning_threshold_pct: parseFloat(editWarningThreshold) }
          : l
      )
    );

    setEditingId(null);
    setSuccessMessage("Limit updated.");
    setSaving(false);

    // Reload exposures
    const { data: expData } = await supabase.from("counterparty_exposure").select("*").eq("org_id", orgId);
    setExposures((expData as unknown as ExposureData[]) ?? []);
  };

  const handleToggleActive = async (limitId: string, currentlyActive: boolean) => {
    const { error: updateError } = await supabase
      .from("counterparty_limits")
      .update({ is_active: !currentlyActive })
      .eq("id", limitId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setLimits((prev) =>
      prev.map((l) => (l.id === limitId ? { ...l, is_active: !currentlyActive } : l))
    );
    setSuccessMessage(currentlyActive ? "Limit deactivated." : "Limit activated.");
  };

  const handleDeleteLimit = async (limitId: string) => {
    if (!confirm("Are you sure you want to delete this limit?")) return;

    const { error: deleteError } = await supabase
      .from("counterparty_limits")
      .delete()
      .eq("id", limitId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setLimits((prev) => prev.filter((l) => l.id !== limitId));
    setSuccessMessage("Limit deleted.");
  };

  const breaches = exposures.filter((e) => e.limit_status === "BREACH");
  const warnings = exposures.filter((e) => e.limit_status === "WARNING");

  if (loading && !orgId) {
    return (
      <main>
        <section>
          <h2>Loading...</h2>
        </section>
      </main>
    );
  }

  if (error === "Please sign in to manage counterparty limits.") {
    return null;
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <div className="badge">Risk Management</div>
          <h1>Counterparty Limits</h1>
          <p>Set and monitor exposure limits for counterparties.</p>
        </div>
        <button
          className="primary"
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm}
        >
          + Set New Limit
        </button>
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

      {/* Alerts Section */}
      {(breaches.length > 0 || warnings.length > 0) && (
        <section className="form-card" style={{ marginBottom: "24px" }}>
          <h3>⚠️ Exposure Alerts</h3>
          {breaches.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ color: "#ef4444", marginBottom: "8px" }}>🚨 Limit Breaches ({breaches.length})</h4>
              {breaches.map((b) => (
                <div
                  key={b.counterparty_id}
                  className="allocation-row"
                  style={{ borderColor: "#ef4444", backgroundColor: "#fee2e2" }}
                >
                  <strong>{b.counterparty_name} ({b.short_code})</strong>
                  <span style={{ marginLeft: "12px" }}>
                    Exposure: {formatCurrency(b.total_principal_exposure)} / Limit: {formatCurrency(b.exposure_limit)}
                    {" "}({b.utilization_pct?.toFixed(1)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <h4 style={{ color: "#f59e0b", marginBottom: "8px" }}>⚡ Warning Threshold ({warnings.length})</h4>
              {warnings.map((w) => (
                <div
                  key={w.counterparty_id}
                  className="allocation-row"
                  style={{ borderColor: "#f59e0b", backgroundColor: "#fef3c7" }}
                >
                  <strong>{w.counterparty_name} ({w.short_code})</strong>
                  <span style={{ marginLeft: "12px" }}>
                    Exposure: {formatCurrency(w.total_principal_exposure)} / Limit: {formatCurrency(w.exposure_limit)}
                    {" "}({w.utilization_pct?.toFixed(1)}% - threshold: {w.warning_threshold_pct}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showAddForm && (
        <section className="form-card">
          <h3>Set New Counterparty Limit</h3>
          <div className="section-grid">
            <div>
              <label>Counterparty</label>
              <select
                value={selectedCounterpartyId}
                onChange={(e) => setSelectedCounterpartyId(e.target.value)}
              >
                <option value="">Select counterparty...</option>
                {counterparties.map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.name} ({cp.short_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Limit Amount (LKR)</label>
              <input
                type="number"
                value={limitAmount}
                onChange={(e) => setLimitAmount(e.target.value)}
                placeholder="e.g., 1000000000"
                min="0"
              />
            </div>
            <div>
              <label>Warning Threshold (%)</label>
              <input
                type="number"
                value={warningThreshold}
                onChange={(e) => setWarningThreshold(e.target.value)}
                min="0"
                max="100"
              />
            </div>
            <div>
              <label>Effective From</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>
          <div className="actions" style={{ marginTop: "16px" }}>
            <button className="primary" onClick={handleAddLimit} disabled={saving}>
              {saving ? "Saving..." : "Save Limit"}
            </button>
            <button className="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Exposure Summary */}
      <section style={{ marginTop: "24px" }}>
        <h2>Current Exposure by Counterparty</h2>
        {exposures.length === 0 ? (
          <div className="allocation-row">
            <p>No counterparty exposure data available.</p>
          </div>
        ) : (
          <div className="allocations">
            {exposures.map((exp) => (
              <div
                key={exp.counterparty_id}
                className="allocation-row"
                style={{
                  borderColor:
                    exp.limit_status === "BREACH"
                      ? "#ef4444"
                      : exp.limit_status === "WARNING"
                      ? "#f59e0b"
                      : undefined
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{exp.counterparty_name}</strong>
                    <span style={{ marginLeft: "8px", color: "var(--muted)" }}>({exp.short_code})</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                      {formatCurrency(exp.total_principal_exposure)}
                    </div>
                    {exp.exposure_limit > 0 && (
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                        of {formatCurrency(exp.exposure_limit)} ({exp.utilization_pct?.toFixed(1)}%)
                      </div>
                    )}
                    {exp.limit_status === "NO_LIMIT" && (
                      <span className="badge" style={{ fontSize: "0.7rem" }}>No Limit Set</span>
                    )}
                  </div>
                </div>
                {exp.exposure_limit > 0 && (
                  <div style={{ marginTop: "8px" }}>
                    <div
                      style={{
                        height: "8px",
                        backgroundColor: "#e5e7eb",
                        borderRadius: "4px",
                        overflow: "hidden"
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(exp.utilization_pct ?? 0, 100)}%`,
                          backgroundColor:
                            exp.limit_status === "BREACH"
                              ? "#ef4444"
                              : exp.limit_status === "WARNING"
                              ? "#f59e0b"
                              : "var(--reef)",
                          transition: "width 0.3s ease"
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Limits List */}
      <section style={{ marginTop: "24px" }}>
        <h2>Configured Limits ({limits.length})</h2>
        {limits.length === 0 ? (
          <div className="allocation-row">
            <p>No limits configured. Click "Set New Limit" to add one.</p>
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Limit Amount</th>
                <th>Warning %</th>
                <th>Effective From</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {limits.map((limit) => (
                <tr key={limit.id} style={{ opacity: limit.is_active ? 1 : 0.5 }}>
                  <td>
                    <strong>{limit.counterparty_name}</strong>
                    <br />
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      {limit.counterparty_code}
                    </span>
                  </td>
                  <td>
                    {editingId === limit.id ? (
                      <input
                        type="number"
                        value={editLimitAmount}
                        onChange={(e) => setEditLimitAmount(e.target.value)}
                        style={{ width: "120px" }}
                      />
                    ) : (
                      formatCurrency(limit.limit_amount)
                    )}
                  </td>
                  <td>
                    {editingId === limit.id ? (
                      <input
                        type="number"
                        value={editWarningThreshold}
                        onChange={(e) => setEditWarningThreshold(e.target.value)}
                        style={{ width: "60px" }}
                        min="0"
                        max="100"
                      />
                    ) : (
                      `${limit.warning_threshold_pct}%`
                    )}
                  </td>
                  <td>{new Date(limit.effective_from).toLocaleDateString()}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        backgroundColor: limit.is_active ? "#d1fae5" : "#e5e7eb",
                        color: limit.is_active ? "#047857" : "#6b7280"
                      }}
                    >
                      {limit.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {editingId === limit.id ? (
                      <>
                        <button
                          className="ghost"
                          onClick={() => handleUpdateLimit(limit.id)}
                          disabled={saving}
                        >
                          Save
                        </button>
                        <button className="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="ghost"
                          onClick={() => {
                            setEditingId(limit.id);
                            setEditLimitAmount(limit.limit_amount.toString());
                            setEditWarningThreshold(limit.warning_threshold_pct.toString());
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="ghost"
                          onClick={() => handleToggleActive(limit.id, limit.is_active)}
                        >
                          {limit.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button className="ghost" onClick={() => handleDeleteLimit(limit.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

