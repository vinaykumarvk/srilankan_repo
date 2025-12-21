"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AccrualSummary = {
  accrual_date: string;
  total_accrued: number;
  allocation_count: number;
};

type AccrualDetail = {
  id: string;
  accrual_date: string;
  accrued_interest: number;
  repo_allocations: {
    id: string;
    principal: number;
    portfolios: { name: string } | null;
    repo_trades: { rate: number; maturity_date: string } | null;
  } | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-LK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export default function AccrualsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string>("");
  const [accrualSummaries, setAccrualSummaries] = useState<AccrualSummary[]>([]);
  const [accrualDetails, setAccrualDetails] = useState<AccrualDetail[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");

  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [running, setRunning] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<{
    allocations_processed: number;
    accruals_created: number;
    errors_count: number;
  } | null>(null);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to manage accruals.");
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

      // Get daily summaries
      const { data: summaryData, error: summaryError } = await supabase
        .from("repo_accruals")
        .select("accrual_date, accrued_interest")
        .eq("org_id", orgId)
        .order("accrual_date", { ascending: false });

      if (summaryError) {
        setError(summaryError.message);
        setLoading(false);
        return;
      }

      // Aggregate by date
      const byDate = new Map<string, { total: number; count: number }>();
      (summaryData ?? []).forEach((row) => {
        const existing = byDate.get(row.accrual_date) || { total: 0, count: 0 };
        byDate.set(row.accrual_date, {
          total: existing.total + row.accrued_interest,
          count: existing.count + 1,
        });
      });

      const summaries: AccrualSummary[] = Array.from(byDate.entries())
        .map(([date, data]) => ({
          accrual_date: date,
          total_accrued: data.total,
          allocation_count: data.count,
        }))
        .sort((a, b) => b.accrual_date.localeCompare(a.accrual_date));

      setAccrualSummaries(summaries);
      setLoading(false);
    };

    loadData();
  }, [orgId]);

  useEffect(() => {
    if (!selectedDate || !orgId) {
      setAccrualDetails([]);
      return;
    }

    const loadDetails = async () => {
      const { data, error: detailsError } = await supabase
        .from("repo_accruals")
        .select(`
          id,
          accrual_date,
          accrued_interest,
          repo_allocations (
            id,
            principal,
            portfolios ( name ),
            repo_trades ( rate, maturity_date )
          )
        `)
        .eq("org_id", orgId)
        .eq("accrual_date", selectedDate)
        .order("accrued_interest", { ascending: false });

      if (detailsError) {
        setError(detailsError.message);
        return;
      }

      setAccrualDetails((data as unknown as AccrualDetail[]) ?? []);
    };

    loadDetails();
  }, [selectedDate, orgId]);

  const handleRunAccruals = async () => {
    if (!runDate) {
      setError("Please select a date to run accruals.");
      return;
    }

    setRunning(true);
    setError(null);
    setSuccessMessage(null);
    setLastRunResult(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("run_daily_accruals", {
        p_org_id: orgId,
        p_accrual_date: runDate,
      });

      if (rpcError) {
        setError(rpcError.message);
        setRunning(false);
        return;
      }

      const result = data?.[0] || { allocations_processed: 0, accruals_created: 0, errors_count: 0 };
      setLastRunResult(result);
      setSuccessMessage(
        `Accrual run completed: ${result.allocations_processed} allocations processed, ${result.accruals_created} accruals created.`
      );

      // Reload summaries
      const { data: summaryData } = await supabase
        .from("repo_accruals")
        .select("accrual_date, accrued_interest")
        .eq("org_id", orgId)
        .order("accrual_date", { ascending: false });

      const byDate = new Map<string, { total: number; count: number }>();
      (summaryData ?? []).forEach((row) => {
        const existing = byDate.get(row.accrual_date) || { total: 0, count: 0 };
        byDate.set(row.accrual_date, {
          total: existing.total + row.accrued_interest,
          count: existing.count + 1,
        });
      });

      const summaries: AccrualSummary[] = Array.from(byDate.entries())
        .map(([date, data]) => ({
          accrual_date: date,
          total_accrued: data.total,
          allocation_count: data.count,
        }))
        .sort((a, b) => b.accrual_date.localeCompare(a.accrual_date));

      setAccrualSummaries(summaries);
    } catch (err) {
      setError("Failed to run accruals. Make sure the database function exists.");
    }

    setRunning(false);
  };

  const handleRunMultipleDays = async () => {
    if (!runDate) return;

    const startDate = new Date(runDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDate > today) {
      setError("Cannot run accruals for future dates.");
      return;
    }

    setRunning(true);
    setError(null);
    setSuccessMessage(null);

    let totalProcessed = 0;
    let totalCreated = 0;
    let daysProcessed = 0;

    const currentDate = new Date(startDate);
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().slice(0, 10);
      try {
        const { data } = await supabase.rpc("run_daily_accruals", {
          p_org_id: orgId,
          p_accrual_date: dateStr,
        });
        const result = data?.[0] || { allocations_processed: 0, accruals_created: 0 };
        totalProcessed += result.allocations_processed;
        totalCreated += result.accruals_created;
        daysProcessed++;
      } catch {
        // Continue on error
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    setSuccessMessage(
      `Batch run completed: ${daysProcessed} days processed, ${totalCreated} total accruals created.`
    );
    setRunning(false);

    // Reload
    const { data: summaryData } = await supabase
      .from("repo_accruals")
      .select("accrual_date, accrued_interest")
      .eq("org_id", orgId)
      .order("accrual_date", { ascending: false });

    const byDate = new Map<string, { total: number; count: number }>();
    (summaryData ?? []).forEach((row) => {
      const existing = byDate.get(row.accrual_date) || { total: 0, count: 0 };
      byDate.set(row.accrual_date, {
        total: existing.total + row.accrued_interest,
        count: existing.count + 1,
      });
    });

    const summaries: AccrualSummary[] = Array.from(byDate.entries())
      .map(([date, data]) => ({
        accrual_date: date,
        total_accrued: data.total,
        allocation_count: data.count,
      }))
      .sort((a, b) => b.accrual_date.localeCompare(a.accrual_date));

    setAccrualSummaries(summaries);
  };

  if (loading && !orgId) {
    return (
      <main>
        <section>
          <h2>Loading...</h2>
        </section>
      </main>
    );
  }

  if (error === "Please sign in to manage accruals.") {
    return null;
  }

  const totalAccruedAllTime = accrualSummaries.reduce((sum, s) => sum + s.total_accrued, 0);

  return (
    <main>
      <header className="page-header">
        <div>
          <div className="badge">Operations</div>
          <h1>Daily Accruals</h1>
          <p>Run and monitor daily interest accrual calculations for repo allocations.</p>
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

      {/* Run Accruals Section */}
      <section className="form-card">
        <h3>Run Daily Accruals</h3>
        <p className="footer-note" style={{ marginBottom: "16px" }}>
          Calculate and record daily interest accruals for all active repo allocations.
        </p>
        <div className="section-grid">
          <div>
            <label>Accrual Date</label>
            <input
              type="date"
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "12px" }}>
            <button className="primary" onClick={handleRunAccruals} disabled={running}>
              {running ? "Running..." : "Run for Selected Date"}
            </button>
            <button className="secondary" onClick={handleRunMultipleDays} disabled={running}>
              {running ? "Running..." : "Run from Date to Today"}
            </button>
          </div>
        </div>

        {lastRunResult && (
          <div className="summary-card" style={{ marginTop: "16px" }}>
            <div className="summary-item">
              <label>Allocations Processed</label>
              <div>{lastRunResult.allocations_processed}</div>
            </div>
            <div className="summary-item">
              <label>Accruals Created</label>
              <div>{lastRunResult.accruals_created}</div>
            </div>
            <div className="summary-item">
              <label>Errors</label>
              <div style={{ color: lastRunResult.errors_count > 0 ? "#ef4444" : "inherit" }}>
                {lastRunResult.errors_count}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Summary Card */}
      <section className="summary-card" style={{ marginTop: "24px" }}>
        <div className="summary-item">
          <label>Total Accrued (All Time)</label>
          <div>{formatCurrency(totalAccruedAllTime)}</div>
        </div>
        <div className="summary-item">
          <label>Days with Accruals</label>
          <div>{accrualSummaries.length}</div>
        </div>
        <div className="summary-item">
          <label>Latest Accrual Date</label>
          <div>{accrualSummaries.length > 0 ? formatDate(accrualSummaries[0].accrual_date) : "None"}</div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: "24px", marginTop: "24px" }}>
        {/* Daily Summaries */}
        <section>
          <h2>Accrual History</h2>
          {accrualSummaries.length === 0 ? (
            <div className="allocation-row">
              <p>No accruals recorded yet. Run the daily accrual job above.</p>
            </div>
          ) : (
            <div className="allocations" style={{ maxHeight: "500px", overflowY: "auto" }}>
              {accrualSummaries.map((summary) => (
                <div
                  key={summary.accrual_date}
                  className={`allocation-row ${selectedDate === summary.accrual_date ? "selected" : ""}`}
                  style={{
                    cursor: "pointer",
                    borderColor: selectedDate === summary.accrual_date ? "var(--reef)" : undefined,
                  }}
                  onClick={() => setSelectedDate(summary.accrual_date)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong>{formatDate(summary.accrual_date)}</strong>
                      <p className="footer-note" style={{ margin: 0 }}>
                        {summary.allocation_count} allocation{summary.allocation_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 600 }}>
                      {formatCurrency(summary.total_accrued)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Detail View */}
        <section>
          {selectedDate ? (
            <>
              <h2>Accruals for {formatDate(selectedDate)}</h2>
              {accrualDetails.length === 0 ? (
                <div className="allocation-row">
                  <p>Loading details...</p>
                </div>
              ) : (
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Portfolio</th>
                      <th>Principal</th>
                      <th>Rate</th>
                      <th>Maturity</th>
                      <th style={{ textAlign: "right" }}>Daily Accrual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accrualDetails.map((detail) => (
                      <tr key={detail.id}>
                        <td>{detail.repo_allocations?.portfolios?.name ?? "Unknown"}</td>
                        <td>{formatCurrency(detail.repo_allocations?.principal ?? 0)}</td>
                        <td>{((detail.repo_allocations?.repo_trades?.rate ?? 0) * 100).toFixed(2)}%</td>
                        <td>
                          {detail.repo_allocations?.repo_trades?.maturity_date
                            ? formatDate(detail.repo_allocations.repo_trades.maturity_date)
                            : "-"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {formatCurrency(detail.accrued_interest)}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700, borderTop: "2px solid var(--reef)" }}>
                      <td colSpan={4}>Total</td>
                      <td style={{ textAlign: "right" }}>
                        {formatCurrency(accrualDetails.reduce((sum, d) => sum + d.accrued_interest, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ opacity: 0.5, marginBottom: "16px" }}
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              <p>Select a date to view accrual details</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

