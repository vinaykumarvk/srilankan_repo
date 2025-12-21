"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
};

type UserRole = "FO_TRADER" | "BO_OPERATIONS" | "RISK_COMPLIANCE" | "OPS_SUPERVISOR" | "READ_ONLY";

export default function ApprovePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<RepoTrade[]>([]);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [processing, setProcessing] = useState<string | null>(null);

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

      // Load pending trades
      const { data: tradesData, error: tradesError } = await supabase
        .from("repo_trades")
        .select(`
          id, status, issue_date, maturity_date, rate, day_count_basis, notes, created_at, created_by,
          counterparty:counterparties(name),
          repo_security:securities(symbol, name)
        `)
        .eq("org_id", memberData.org_id)
        .in("status", ["DRAFT", "PENDING_APPROVAL", "APPROVED"])
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

  const hasApproveRole = userRole === "BO_OPERATIONS" || userRole === "OPS_SUPERVISOR";
  
  // Check if user can approve a specific trade (can't approve own trades)
  const canApproveTrade = (trade: RepoTrade) => {
    if (!hasApproveRole) return false;
    if (trade.created_by === userId) return false; // Can't approve own trades
    return true;
  };
  
  const isOwnTrade = (trade: RepoTrade) => trade.created_by === userId;

  const handleApprove = async (tradeId: string) => {
    if (!hasApproveRole) return;
    setProcessing(tradeId);

    const { error } = await supabase
      .from("repo_trades")
      .update({ status: "APPROVED", approved_at: new Date().toISOString() })
      .eq("id", tradeId);

    if (error) {
      alert("Error approving: " + error.message);
    } else {
      setTrades((prev) =>
        prev.map((t) => (t.id === tradeId ? { ...t, status: "APPROVED" } : t))
      );
    }
    setProcessing(null);
  };

  const handlePost = async (tradeId: string) => {
    if (!hasApproveRole) return;
    setProcessing(tradeId);

    const { error } = await supabase
      .from("repo_trades")
      .update({ status: "POSTED", posted_at: new Date().toISOString() })
      .eq("id", tradeId);

    if (error) {
      alert("Error posting: " + error.message);
    } else {
      setTrades((prev) =>
        prev.map((t) => (t.id === tradeId ? { ...t, status: "POSTED" } : t))
      );
    }
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
          <p>✅ You have <strong>{userRole}</strong> permissions. You can approve trades created by other users.</p>
        </section>
      )}

      <section>
        <h2>Pending & Recent Trades ({trades.length})</h2>
        
        {trades.length === 0 ? (
          <p className="empty-state">No trades found. Submit a repo from the entry page first.</p>
        ) : (
          <div className="trades-list">
            {trades.map((trade) => (
              <div key={trade.id} className="trade-card">
                <div className="trade-header">
                  <span className={`badge ${getStatusBadge(trade.status)}`}>
                    {trade.status}
                  </span>
                  <span className="trade-date">
                    Created: {formatDate(trade.created_at)}
                  </span>
                </div>
                
                <div className="trade-details">
                  <div className="detail-row">
                    <label>Security</label>
                    <span>{trade.repo_security?.symbol || "N/A"}</span>
                  </div>
                  <div className="detail-row">
                    <label>Counterparty</label>
                    <span>{trade.counterparty?.name || "N/A"}</span>
                  </div>
                  <div className="detail-row">
                    <label>Issue Date</label>
                    <span>{formatDate(trade.issue_date)}</span>
                  </div>
                  <div className="detail-row">
                    <label>Maturity Date</label>
                    <span>{formatDate(trade.maturity_date)}</span>
                  </div>
                  <div className="detail-row">
                    <label>Rate</label>
                    <span>{formatRate(trade.rate)}</span>
                  </div>
                  <div className="detail-row">
                    <label>Day Count</label>
                    <span>{trade.day_count_basis}</span>
                  </div>
                  {trade.notes && (
                    <div className="detail-row full-width">
                      <label>Notes</label>
                      <span>{trade.notes}</span>
                    </div>
                  )}
                </div>

                <div className="trade-actions">
                  {trade.status === "DRAFT" && (
                    <>
                      {canApproveTrade(trade) ? (
                        <>
                          <button
                            className="primary"
                            onClick={() => handleApprove(trade.id)}
                            disabled={processing === trade.id}
                          >
                            {processing === trade.id ? "..." : "Approve"}
                          </button>
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
                        {processing === trade.id ? "..." : "Post to System"}
                      </button>
                    ) : (
                      <span className="approved-label">✓ Approved - awaiting posting</span>
                    )
                  )}
                  {trade.status === "POSTED" && (
                    <span className="posted-label">✓ Posted</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
