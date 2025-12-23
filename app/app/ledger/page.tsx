"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Portfolio = { id: string; name: string };
type Counterparty = { id: string; name: string; short_code: string };

type LedgerEntry = {
  id: string;
  entry_date: string;
  value_date: string;
  entry_type: string;
  debit_amount: number;
  credit_amount: number;
  currency: string;
  description: string | null;
  reference_number: string | null;
  is_reversed: boolean;
  portfolios: { name: string } | null;
  counterparties: { name: string; short_code: string } | null;
  repo_allocation_id: string | null;
  created_at: string;
};

const ENTRY_TYPES = [
  { value: "PRINCIPAL", label: "Principal" },
  { value: "INTEREST_ACCRUAL", label: "Interest Accrual" },
  { value: "INTEREST_RECEIVED", label: "Interest Received" },
  { value: "INTEREST_PAID", label: "Interest Paid" },
  { value: "COLLATERAL_IN", label: "Collateral In" },
  { value: "COLLATERAL_OUT", label: "Collateral Out" },
  { value: "FEE", label: "Fee" },
  { value: "ADJUSTMENT", label: "Adjustment" },
];

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

export default function LedgerPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);

  // Filters
  const [filterPortfolioId, setFilterPortfolioId] = useState("");
  const [filterCounterpartyId, setFilterCounterpartyId] = useState("");
  const [filterEntryType, setFilterEntryType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // New entry form
  const [showAddForm, setShowAddForm] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryType, setEntryType] = useState("PRINCIPAL");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState("");
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState("");
  const [debitAmount, setDebitAmount] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to view ledger.");
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
    };

    init();
  }, []);

  useEffect(() => {
    if (!orgId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const [portfoliosRes, counterpartiesRes, entriesRes] = await Promise.all([
        supabase.from("portfolios").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
        supabase.from("counterparties").select("id, name, short_code").eq("org_id", orgId).eq("is_active", true).order("name"),
        supabase
          .from("ledger_entries")
          .select(`
            id, entry_date, value_date, entry_type, debit_amount, credit_amount,
            currency, description, reference_number, is_reversed, repo_allocation_id, created_at,
            portfolios ( name ),
            counterparties ( name, short_code )
          `)
          .eq("org_id", orgId)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (portfoliosRes.error || counterpartiesRes.error || entriesRes.error) {
        setError(portfoliosRes.error?.message || counterpartiesRes.error?.message || entriesRes.error?.message || "Failed to load data.");
        setLoading(false);
        return;
      }

      setPortfolios(portfoliosRes.data ?? []);
      setCounterparties(counterpartiesRes.data ?? []);
      setEntries((entriesRes.data as unknown as LedgerEntry[]) ?? []);
      setLoading(false);
    };

    loadData();
  }, [orgId]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filterPortfolioId && entry.portfolios?.name !== portfolios.find((p) => p.id === filterPortfolioId)?.name) {
        return false;
      }
      if (filterCounterpartyId && entry.counterparties?.short_code !== counterparties.find((c) => c.id === filterCounterpartyId)?.short_code) {
        return false;
      }
      if (filterEntryType && entry.entry_type !== filterEntryType) {
        return false;
      }
      if (filterDateFrom && entry.entry_date < filterDateFrom) {
        return false;
      }
      if (filterDateTo && entry.entry_date > filterDateTo) {
        return false;
      }
      return true;
    });
  }, [entries, filterPortfolioId, filterCounterpartyId, filterEntryType, filterDateFrom, filterDateTo, portfolios, counterparties]);

  const totals = useMemo(() => {
    return filteredEntries.reduce(
      (acc, entry) => ({
        debit: acc.debit + entry.debit_amount,
        credit: acc.credit + entry.credit_amount,
      }),
      { debit: 0, credit: 0 }
    );
  }, [filteredEntries]);

  const handleAddEntry = async () => {
    if (!debitAmount && !creditAmount) {
      setError("Please enter a debit or credit amount.");
      return;
    }

    setSaving(true);
    setError(null);

    const { data, error: insertError } = await supabase
      .from("ledger_entries")
      .insert({
        org_id: orgId,
        portfolio_id: selectedPortfolioId || null,
        counterparty_id: selectedCounterpartyId || null,
        entry_date: entryDate,
        value_date: valueDate,
        entry_type: entryType,
        debit_amount: parseFloat(debitAmount) || 0,
        credit_amount: parseFloat(creditAmount) || 0,
        currency: "LKR",
        description: description || null,
        reference_number: referenceNumber || null,
        created_by: userId,
      })
      .select(`
        id, entry_date, value_date, entry_type, debit_amount, credit_amount,
        currency, description, reference_number, is_reversed, repo_allocation_id, created_at,
        portfolios ( name ),
        counterparties ( name, short_code )
      `)
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setEntries((prev) => [data as unknown as LedgerEntry, ...prev]);
    setShowAddForm(false);
    resetForm();
    setSuccessMessage("Ledger entry created.");
    setSaving(false);
  };

  const handleReverseEntry = async (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    if (!confirm(`Reverse this entry? A new entry will be created with opposite amounts.`)) return;

    // Create reversal entry
    const { data, error: insertError } = await supabase
      .from("ledger_entries")
      .insert({
        org_id: orgId,
        portfolio_id: entry.portfolios ? portfolios.find((p) => p.name === entry.portfolios?.name)?.id : null,
        counterparty_id: entry.counterparties ? counterparties.find((c) => c.short_code === entry.counterparties?.short_code)?.id : null,
        entry_date: new Date().toISOString().slice(0, 10),
        value_date: entry.value_date,
        entry_type: entry.entry_type,
        debit_amount: entry.credit_amount, // Swap debit/credit
        credit_amount: entry.debit_amount,
        currency: entry.currency,
        description: `Reversal of: ${entry.description || entry.reference_number || entryId}`,
        reference_number: `REV-${entry.reference_number || entryId.slice(0, 8)}`,
        reversed_by_id: entryId,
        created_by: userId,
      })
      .select(`
        id, entry_date, value_date, entry_type, debit_amount, credit_amount,
        currency, description, reference_number, is_reversed, repo_allocation_id, created_at,
        portfolios ( name ),
        counterparties ( name, short_code )
      `)
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    // Mark original as reversed
    await supabase.from("ledger_entries").update({ is_reversed: true }).eq("id", entryId);

    setEntries((prev) => [
      data as unknown as LedgerEntry,
      ...prev.map((e) => (e.id === entryId ? { ...e, is_reversed: true } : e)),
    ]);
    setSuccessMessage("Entry reversed.");
  };

  const resetForm = () => {
    setEntryDate(new Date().toISOString().slice(0, 10));
    setValueDate(new Date().toISOString().slice(0, 10));
    setEntryType("PRINCIPAL");
    setSelectedPortfolioId("");
    setSelectedCounterpartyId("");
    setDebitAmount("");
    setCreditAmount("");
    setDescription("");
    setReferenceNumber("");
  };

  const clearFilters = () => {
    setFilterPortfolioId("");
    setFilterCounterpartyId("");
    setFilterEntryType("");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  const exportToCSV = () => {
    const headers = ["Date", "Value Date", "Type", "Portfolio", "Counterparty", "Debit", "Credit", "Description", "Reference"];
    const rows = filteredEntries.map((e) => [
      e.entry_date,
      e.value_date,
      e.entry_type,
      e.portfolios?.name || "",
      e.counterparties?.name || "",
      e.debit_amount.toString(),
      e.credit_amount.toString(),
      e.description || "",
      e.reference_number || "",
    ]);

    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
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

  if (error === "Please sign in to view ledger.") {
    return null;
  }

  return (
    <main>
      {/* Action buttons */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", justifyContent: "flex-end" }}>
        <button className="secondary" onClick={exportToCSV}>
          Export CSV
        </button>
        <button className="primary" onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          + New Entry
        </button>
      </div>

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

      {showAddForm && (
        <section className="form-card">
          <h3>Create Manual Entry</h3>
          <div className="section-grid">
            <div>
              <label>Entry Date</label>
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div>
              <label>Value Date</label>
              <input type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} />
            </div>
            <div>
              <label>Entry Type</label>
              <select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
                {ENTRY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Portfolio (Optional)</label>
              <select value={selectedPortfolioId} onChange={(e) => setSelectedPortfolioId(e.target.value)}>
                <option value="">-- None --</option>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Counterparty (Optional)</label>
              <select value={selectedCounterpartyId} onChange={(e) => setSelectedCounterpartyId(e.target.value)}>
                <option value="">-- None --</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.short_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Debit Amount (LKR)</label>
              <input
                type="number"
                value={debitAmount}
                onChange={(e) => setDebitAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label>Credit Amount (LKR)</label>
              <input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label>Reference Number</label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g., INV-001"
              />
            </div>
          </div>
          <div style={{ marginTop: "12px" }}>
            <label>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Entry description..."
            />
          </div>
          <div className="actions" style={{ marginTop: "16px" }}>
            <button className="primary" onClick={handleAddEntry} disabled={saving}>
              {saving ? "Saving..." : "Create Entry"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setShowAddForm(false);
                resetForm();
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Summary */}
      <section className="summary-card" style={{ marginTop: "24px" }}>
        <div className="summary-item">
          <label>Total Debits</label>
          <div>{formatCurrency(totals.debit)}</div>
        </div>
        <div className="summary-item">
          <label>Total Credits</label>
          <div>{formatCurrency(totals.credit)}</div>
        </div>
        <div className="summary-item">
          <label>Net Balance</label>
          <div style={{ color: totals.debit - totals.credit >= 0 ? "inherit" : "#ef4444" }}>
            {formatCurrency(totals.debit - totals.credit)}
          </div>
        </div>
        <div className="summary-item">
          <label>Entries</label>
          <div>{filteredEntries.length}</div>
        </div>
      </section>

      {/* Filters */}
      <section className="form-card" style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0 }}>Filters</h3>
          <button className="ghost" onClick={clearFilters}>
            Clear All
          </button>
        </div>
        <div className="section-grid">
          <div>
            <label>Portfolio</label>
            <select value={filterPortfolioId} onChange={(e) => setFilterPortfolioId(e.target.value)}>
              <option value="">All Portfolios</option>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Counterparty</label>
            <select value={filterCounterpartyId} onChange={(e) => setFilterCounterpartyId(e.target.value)}>
              <option value="">All Counterparties</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Entry Type</label>
            <select value={filterEntryType} onChange={(e) => setFilterEntryType(e.target.value)}>
              <option value="">All Types</option>
              {ENTRY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Date From</label>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
          </div>
          <div>
            <label>Date To</label>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Entries Table */}
      <section style={{ marginTop: "24px" }}>
        <h2>Ledger Entries</h2>
        {filteredEntries.length === 0 ? (
          <div className="allocation-row">
            <p>No entries found. Create one using the button above or adjust filters.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", minWidth: "900px" }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Portfolio</th>
                  <th>Counterparty</th>
                  <th style={{ textAlign: "right" }}>Debit</th>
                  <th style={{ textAlign: "right" }}>Credit</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} style={{ opacity: entry.is_reversed ? 0.5 : 1 }}>
                    <td>
                      {formatDate(entry.entry_date)}
                      {entry.entry_date !== entry.value_date && (
                        <br />
                      )}
                      {entry.entry_date !== entry.value_date && (
                        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          Val: {formatDate(entry.value_date)}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          fontSize: "0.7rem",
                          backgroundColor:
                            entry.entry_type === "PRINCIPAL"
                              ? "#dbeafe"
                              : entry.entry_type.includes("INTEREST")
                              ? "#d1fae5"
                              : entry.entry_type.includes("COLLATERAL")
                              ? "#fef3c7"
                              : "#f3e8ff",
                        }}
                      >
                        {ENTRY_TYPES.find((t) => t.value === entry.entry_type)?.label || entry.entry_type}
                      </span>
                      {entry.is_reversed && (
                        <span className="badge" style={{ fontSize: "0.65rem", marginLeft: "4px", backgroundColor: "#fee2e2" }}>
                          REVERSED
                        </span>
                      )}
                    </td>
                    <td>{entry.portfolios?.name || "-"}</td>
                    <td>
                      {entry.counterparties?.name || "-"}
                      {entry.counterparties && (
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                          {" "}
                          ({entry.counterparties.short_code})
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                      {entry.debit_amount > 0 ? formatCurrency(entry.debit_amount) : "-"}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                      {entry.credit_amount > 0 ? formatCurrency(entry.credit_amount) : "-"}
                    </td>
                    <td style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {entry.description || "-"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{entry.reference_number || "-"}</td>
                    <td>
                      {!entry.is_reversed && (
                        <button className="ghost" onClick={() => handleReverseEntry(entry.id)}>
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}


