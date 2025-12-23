"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrgOption = { id: string; name: string };
type Holiday = {
  id: string;
  holiday_date: string;
  description: string | null;
  created_at: string;
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-LK", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
};

const getDayOfWeek = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-LK", { weekday: "long" });
};

// Common Sri Lankan holidays (for quick-add)
const commonHolidays = [
  { month: 1, day: 14, name: "Tamil Thai Pongal Day" },
  { month: 1, day: 15, name: "Duruthu Full Moon Poya Day" },
  { month: 2, day: 4, name: "Independence Day" },
  { month: 2, day: 14, name: "Navam Full Moon Poya Day" },
  { month: 3, day: 14, name: "Medin Full Moon Poya Day" },
  { month: 4, day: 13, name: "Day Prior to Sinhala & Tamil New Year" },
  { month: 4, day: 14, name: "Sinhala & Tamil New Year Day" },
  { month: 5, day: 1, name: "May Day" },
  { month: 5, day: 23, name: "Vesak Full Moon Poya Day" },
  { month: 5, day: 24, name: "Day Following Vesak Full Moon Poya Day" },
  { month: 6, day: 21, name: "Poson Full Moon Poya Day" },
  { month: 7, day: 21, name: "Esala Full Moon Poya Day" },
  { month: 8, day: 19, name: "Nikini Full Moon Poya Day" },
  { month: 9, day: 18, name: "Binara Full Moon Poya Day" },
  { month: 10, day: 17, name: "Vap Full Moon Poya Day" },
  { month: 11, day: 1, name: "Deepavali Festival Day" },
  { month: 11, day: 15, name: "Il Full Moon Poya Day" },
  { month: 12, day: 15, name: "Unduvap Full Moon Poya Day" },
  { month: 12, day: 25, name: "Christmas Day" }
];

export default function HolidayCalendarPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>("");

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  // New holiday form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [adding, setAdding] = useState(false);

  // Bulk add state
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkYear, setBulkYear] = useState(new Date().getFullYear());
  const [selectedBulkHolidays, setSelectedBulkHolidays] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to manage holidays.");
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

      const memberRows = (memberData as Array<{
        org_id: string;
        orgs?: { id?: string; name?: string } | null;
      }>) ?? [];

      const orgs: OrgOption[] = memberRows
        .map((row) => ({
          id: row.org_id,
          name: row.orgs?.name ?? row.org_id
        }))
        .filter((row) => Boolean(row.id));

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

  useEffect(() => {
    if (!orgId) return;

    const loadHolidays = async () => {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);

      const { data, error: loadError } = await supabase
        .from("org_holidays")
        .select("id, holiday_date, description, created_at")
        .eq("org_id", orgId)
        .order("holiday_date", { ascending: true });

      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }

      setHolidays(data ?? []);
      setLoading(false);
    };

    loadHolidays();
  }, [orgId]);

  const filteredHolidays = useMemo(() => {
    return holidays.filter((h) => {
      const year = new Date(h.holiday_date).getFullYear();
      return year === filterYear;
    });
  }, [holidays, filterYear]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    years.add(currentYear + 1);
    holidays.forEach((h) => {
      years.add(new Date(h.holiday_date).getFullYear());
    });
    return Array.from(years).sort();
  }, [holidays]);

  const handleAddHoliday = async () => {
    if (!newDate) {
      setError("Date is required.");
      return;
    }

    setAdding(true);
    setError(null);

    const { data, error: addError } = await supabase
      .from("org_holidays")
      .insert({
        org_id: orgId,
        holiday_date: newDate,
        description: newDescription.trim() || null
      })
      .select("id, holiday_date, description, created_at")
      .single();

    if (addError) {
      if (addError.message.includes("duplicate")) {
        setError("This date is already marked as a holiday.");
      } else {
        setError(addError.message);
      }
      setAdding(false);
      return;
    }

    setHolidays((prev) =>
      [...prev, data].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
    );
    setNewDate("");
    setNewDescription("");
    setShowAddForm(false);
    setSuccessMessage(`Holiday added: ${formatDate(data.holiday_date)}`);
    setAdding(false);

    // Update filter year to show the new holiday
    const newYear = new Date(data.holiday_date).getFullYear();
    if (newYear !== filterYear) {
      setFilterYear(newYear);
    }
  };

  const handleDeleteHoliday = async (holidayId: string, date: string) => {
    if (!confirm(`Remove holiday on ${formatDate(date)}?`)) return;

    const { error: deleteError } = await supabase
      .from("org_holidays")
      .delete()
      .eq("id", holidayId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setHolidays((prev) => prev.filter((h) => h.id !== holidayId));
    setSuccessMessage(`Holiday removed: ${formatDate(date)}`);
  };

  const handleBulkAdd = async () => {
    if (selectedBulkHolidays.size === 0) {
      setError("Select at least one holiday to add.");
      return;
    }

    setBulkAdding(true);
    setError(null);

    const holidaysToAdd = Array.from(selectedBulkHolidays).map((key) => {
      const [month, day] = key.split("-").map(Number);
      const date = `${bulkYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const template = commonHolidays.find((h) => h.month === month && h.day === day);
      return {
        org_id: orgId,
        holiday_date: date,
        description: template?.name ?? null
      };
    });

    const { data, error: insertError } = await supabase
      .from("org_holidays")
      .insert(holidaysToAdd)
      .select("id, holiday_date, description, created_at");

    if (insertError) {
      if (insertError.message.includes("duplicate")) {
        setError("Some holidays already exist. Remove duplicates and try again.");
      } else {
        setError(insertError.message);
      }
      setBulkAdding(false);
      return;
    }

    setHolidays((prev) =>
      [...prev, ...(data ?? [])].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
    );
    setSelectedBulkHolidays(new Set());
    setShowBulkAdd(false);
    setSuccessMessage(`${data?.length ?? 0} holidays added for ${bulkYear}.`);
    setBulkAdding(false);
    setFilterYear(bulkYear);
  };

  const toggleBulkHoliday = (month: number, day: number) => {
    const key = `${month}-${day}`;
    setSelectedBulkHolidays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllBulkHolidays = () => {
    const existingDates = new Set(
      holidays
        .filter((h) => new Date(h.holiday_date).getFullYear() === bulkYear)
        .map((h) => {
          const d = new Date(h.holiday_date);
          return `${d.getMonth() + 1}-${d.getDate()}`;
        })
    );

    const available = commonHolidays
      .filter((h) => !existingDates.has(`${h.month}-${h.day}`))
      .map((h) => `${h.month}-${h.day}`);

    setSelectedBulkHolidays(new Set(available));
  };

  if (loading && !orgId) {
    return (
      <main>
        <section>
          <h2>Loading...</h2>
          <p>Checking authentication.</p>
        </section>
      </main>
    );
  }

  // Auth is handled by AppShell
  if (error === "Please sign in to manage holidays.") {
    return null;
  }

  return (
    <main>
      {/* Action buttons */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", justifyContent: "flex-end" }}>
        <button
          className="secondary"
          onClick={() => setShowBulkAdd(true)}
          disabled={showBulkAdd}
        >
          Bulk Add Sri Lanka Holidays
        </button>
        <button
          className="primary"
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm}
        >
          + Add Holiday
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
          <h3>Add Single Holiday</h3>
          <div className="section-grid">
            <div>
              <label>Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
            <div>
              <label>Description (optional)</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="e.g., Vesak Full Moon Poya Day"
              />
            </div>
          </div>
          <div className="actions" style={{ marginTop: "16px" }}>
            <button
              className="primary"
              onClick={handleAddHoliday}
              disabled={adding || !newDate}
            >
              {adding ? "Adding..." : "Add Holiday"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setShowAddForm(false);
                setNewDate("");
                setNewDescription("");
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {showBulkAdd && (
        <section className="form-card">
          <h3>Bulk Add Sri Lanka Public Holidays</h3>
          <p className="footer-note" style={{ marginBottom: "16px" }}>
            Select holidays to add for a specific year. Already existing dates are marked.
          </p>
          <div className="section-grid" style={{ marginBottom: "16px" }}>
            <div>
              <label>Year</label>
              <select
                value={bulkYear}
                onChange={(e) => {
                  setBulkYear(Number(e.target.value));
                  setSelectedBulkHolidays(new Set());
                }}
              >
                {[new Date().getFullYear(), new Date().getFullYear() + 1, new Date().getFullYear() + 2].map(
                  (y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  )
                )}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="secondary" onClick={selectAllBulkHolidays}>
                Select All Available
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "8px",
              maxHeight: "300px",
              overflowY: "auto",
              padding: "8px",
              background: "#f8f8f8",
              borderRadius: "8px"
            }}
          >
            {commonHolidays.map((h) => {
              const key = `${h.month}-${h.day}`;
              const dateStr = `${bulkYear}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`;
              const exists = holidays.some((existing) => existing.holiday_date === dateStr);

              return (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 12px",
                    background: exists ? "#e5e5e5" : "white",
                    borderRadius: "6px",
                    cursor: exists ? "not-allowed" : "pointer",
                    opacity: exists ? 0.6 : 1
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedBulkHolidays.has(key)}
                    onChange={() => toggleBulkHoliday(h.month, h.day)}
                    disabled={exists}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <span style={{ flex: 1 }}>
                    <strong>{String(h.day).padStart(2, "0")}/{String(h.month).padStart(2, "0")}</strong>
                    <span style={{ marginLeft: "8px", color: "var(--muted)", fontSize: "0.85rem" }}>
                      {h.name}
                    </span>
                  </span>
                  {exists && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        background: "var(--reef)",
                        color: "white",
                        padding: "2px 6px",
                        borderRadius: "4px"
                      }}
                    >
                      EXISTS
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <div className="actions" style={{ marginTop: "16px" }}>
            <button
              className="primary"
              onClick={handleBulkAdd}
              disabled={bulkAdding || selectedBulkHolidays.size === 0}
            >
              {bulkAdding ? "Adding..." : `Add ${selectedBulkHolidays.size} Holidays`}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setShowBulkAdd(false);
                setSelectedBulkHolidays(new Set());
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <section style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2>
            Holidays in {filterYear} ({filteredHolidays.length})
          </h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label style={{ marginBottom: 0 }}>Year:</label>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(Number(e.target.value))}
              style={{ width: "100px" }}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredHolidays.length === 0 ? (
          <div className="allocation-row">
            <p>No holidays defined for {filterYear}. Add some using the buttons above.</p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "12px"
            }}
          >
            {filteredHolidays.map((holiday) => (
              <div
                key={holiday.id}
                className="allocation-row"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div
                      style={{
                        width: "50px",
                        height: "50px",
                        background: "linear-gradient(135deg, var(--reef), #148f82)",
                        borderRadius: "10px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white"
                      }}
                    >
                      <span style={{ fontSize: "0.7rem", textTransform: "uppercase" }}>
                        {new Date(holiday.holiday_date).toLocaleDateString("en-LK", { month: "short" })}
                      </span>
                      <span style={{ fontSize: "1.2rem", fontWeight: 700, lineHeight: 1 }}>
                        {new Date(holiday.holiday_date).getDate()}
                      </span>
                    </div>
                    <div>
                      <strong>{holiday.description ?? "Holiday"}</strong>
                      <p className="footer-note" style={{ margin: 0 }}>
                        {getDayOfWeek(holiday.holiday_date)}
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  className="ghost"
                  onClick={() => handleDeleteHoliday(holiday.id, holiday.holiday_date)}
                  style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Statistics */}
      <section style={{ marginTop: "24px" }}>
        <h2>Calendar Overview</h2>
        <div className="summary-card">
          <div className="summary-item">
            <label>Total Holidays ({filterYear})</label>
            <div>{filteredHolidays.length}</div>
          </div>
          <div className="summary-item">
            <label>Next Holiday</label>
            <div>
              {(() => {
                const today = new Date().toISOString().slice(0, 10);
                const upcoming = holidays.find((h) => h.holiday_date >= today);
                return upcoming ? formatDate(upcoming.holiday_date) : "None scheduled";
              })()}
            </div>
          </div>
          <div className="summary-item">
            <label>All Years</label>
            <div>{holidays.length} holidays total</div>
          </div>
        </div>
      </section>
    </main>
  );
}


