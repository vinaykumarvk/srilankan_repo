"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Security = {
  id: string;
  symbol: string;
  name: string;
  isin: string | null;
};

type CollateralPrice = {
  id: string;
  security_id: string;
  security_symbol?: string;
  security_name?: string;
  price_date: string;
  clean_price: number;
  dirty_price: number | null;
  yield: number | null;
  source: string;
  created_at: string;
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-LK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export default function CollateralPricesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [securities, setSecurities] = useState<Security[]>([]);
  const [prices, setPrices] = useState<CollateralPrice[]>([]);

  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // Single price form
  const [selectedSecurityId, setSelectedSecurityId] = useState("");
  const [priceDate, setPriceDate] = useState(new Date().toISOString().slice(0, 10));
  const [cleanPrice, setCleanPrice] = useState("");
  const [dirtyPrice, setDirtyPrice] = useState("");
  const [yieldValue, setYieldValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Bulk upload
  const [bulkData, setBulkData] = useState("");
  const [bulkPriceDate, setBulkPriceDate] = useState(new Date().toISOString().slice(0, 10));
  const [bulkUploading, setBulkUploading] = useState(false);

  // Revaluation
  const [revaluationDate, setRevaluationDate] = useState(new Date().toISOString().slice(0, 10));
  const [revaluing, setRevaluing] = useState(false);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to manage collateral prices.");
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

      const [securitiesRes, pricesRes] = await Promise.all([
        supabase
          .from("securities")
          .select("id, symbol, name, isin")
          .eq("org_id", orgId)
          .eq("status", "APPROVED")
          .order("symbol"),
        supabase
          .from("collateral_prices")
          .select("id, security_id, price_date, clean_price, dirty_price, yield, source, created_at, securities ( symbol, name )")
          .eq("org_id", orgId)
          .order("price_date", { ascending: false })
          .limit(200),
      ]);

      if (securitiesRes.error || pricesRes.error) {
        setError(securitiesRes.error?.message || pricesRes.error?.message || "Failed to load data.");
        setLoading(false);
        return;
      }

      setSecurities(securitiesRes.data ?? []);

      const pricesWithNames = (pricesRes.data ?? []).map((p: unknown) => {
        const price = p as CollateralPrice & { securities?: { symbol?: string; name?: string } | null };
        return {
          ...price,
          security_symbol: price.securities?.symbol,
          security_name: price.securities?.name,
        };
      });
      setPrices(pricesWithNames);
      setLoading(false);
    };

    loadData();
  }, [orgId]);

  const handleAddPrice = async () => {
    if (!selectedSecurityId || !cleanPrice) {
      setError("Please select a security and enter a price.");
      return;
    }

    setSaving(true);
    setError(null);

    const { data, error: insertError } = await supabase
      .from("collateral_prices")
      .insert({
        org_id: orgId,
        security_id: selectedSecurityId,
        price_date: priceDate,
        clean_price: parseFloat(cleanPrice),
        dirty_price: dirtyPrice ? parseFloat(dirtyPrice) : null,
        yield: yieldValue ? parseFloat(yieldValue) : null,
        source: "MANUAL",
        created_by: userId,
      })
      .select("id, security_id, price_date, clean_price, dirty_price, yield, source, created_at, securities ( symbol, name )")
      .single();

    if (insertError) {
      if (insertError.message.includes("duplicate")) {
        setError("A price already exists for this security on this date.");
      } else {
        setError(insertError.message);
      }
      setSaving(false);
      return;
    }

    const newPrice = {
      ...data,
      security_symbol: (data as { securities?: { symbol?: string; name?: string } | null }).securities?.symbol,
      security_name: (data as { securities?: { symbol?: string; name?: string } | null }).securities?.name,
    };

    setPrices((prev) => [newPrice as CollateralPrice, ...prev]);
    setShowAddForm(false);
    setSelectedSecurityId("");
    setCleanPrice("");
    setDirtyPrice("");
    setYieldValue("");
    setSuccessMessage("Price added successfully.");
    setSaving(false);
  };

  const handleBulkUpload = async () => {
    if (!bulkData.trim()) {
      setError("Please enter price data.");
      return;
    }

    setBulkUploading(true);
    setError(null);

    try {
      const lines = bulkData.trim().split("\n");
      const pricesToInsert: Array<{
        org_id: string;
        security_id: string;
        price_date: string;
        clean_price: number;
        dirty_price: number | null;
        source: string;
        created_by: string;
      }> = [];

      for (const line of lines) {
        const parts = line.split(",").map((p) => p.trim());
        if (parts.length < 2) continue;

        const symbolOrISIN = parts[0].toUpperCase();
        const price = parseFloat(parts[1]);
        const dirty = parts[2] ? parseFloat(parts[2]) : null;

        if (isNaN(price)) continue;

        // Find security by symbol or ISIN
        const security = securities.find(
          (s) => s.symbol.toUpperCase() === symbolOrISIN || s.isin?.toUpperCase() === symbolOrISIN
        );

        if (security) {
          pricesToInsert.push({
            org_id: orgId,
            security_id: security.id,
            price_date: bulkPriceDate,
            clean_price: price,
            dirty_price: dirty,
            source: "FILE_UPLOAD",
            created_by: userId,
          });
        }
      }

      if (pricesToInsert.length === 0) {
        setError("No valid prices found. Format: SYMBOL,CLEAN_PRICE,DIRTY_PRICE (one per line)");
        setBulkUploading(false);
        return;
      }

      const { data, error: insertError } = await supabase
        .from("collateral_prices")
        .upsert(pricesToInsert, { onConflict: "org_id,security_id,price_date" })
        .select("id, security_id, price_date, clean_price, dirty_price, yield, source, created_at, securities ( symbol, name )");

      if (insertError) {
        setError(insertError.message);
        setBulkUploading(false);
        return;
      }

      const newPrices = (data ?? []).map((p: unknown) => {
        const price = p as CollateralPrice & { securities?: { symbol?: string; name?: string } | null };
        return {
          ...price,
          security_symbol: price.securities?.symbol,
          security_name: price.securities?.name,
        };
      });

      setPrices((prev) => [...newPrices, ...prev.filter((p) => !newPrices.some((np: CollateralPrice) => np.id === p.id))]);
      setShowBulkUpload(false);
      setBulkData("");
      setSuccessMessage(`${pricesToInsert.length} prices uploaded successfully.`);
    } catch {
      setError("Failed to parse price data.");
    }

    setBulkUploading(false);
  };

  const handleRevalueCollateral = async () => {
    setRevaluing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("revalue_collateral", {
        p_org_id: orgId,
        p_valuation_date: revaluationDate,
      });

      if (rpcError) {
        setError(rpcError.message);
        setRevaluing(false);
        return;
      }

      const result = data?.[0] || { positions_updated: 0, total_market_value: 0 };
      setSuccessMessage(
        `Revaluation complete: ${result.positions_updated} positions updated. Total market value: ${new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(result.total_market_value)}`
      );
    } catch {
      setError("Failed to run revaluation. Make sure the database function exists.");
    }

    setRevaluing(false);
  };

  const handleDeletePrice = async (priceId: string) => {
    if (!confirm("Delete this price entry?")) return;

    const { error: deleteError } = await supabase.from("collateral_prices").delete().eq("id", priceId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setPrices((prev) => prev.filter((p) => p.id !== priceId));
    setSuccessMessage("Price deleted.");
  };

  const filteredPrices = filterDate
    ? prices.filter((p) => p.price_date === filterDate)
    : prices;

  if (loading && !orgId) {
    return (
      <main>
        <section>
          <h2>Loading...</h2>
        </section>
      </main>
    );
  }

  if (error === "Please sign in to manage collateral prices.") {
    return null;
  }

  return (
    <main>
      {/* Action buttons */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", justifyContent: "flex-end" }}>
        <button className="secondary" onClick={() => setShowBulkUpload(true)} disabled={showBulkUpload}>
          Bulk Upload
        </button>
        <button className="primary" onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          + Add Price
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
          <h3>Add Single Price</h3>
          <div className="section-grid">
            <div>
              <label>Security</label>
              <select value={selectedSecurityId} onChange={(e) => setSelectedSecurityId(e.target.value)}>
                <option value="">Select security...</option>
                {securities.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.symbol} - {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Price Date</label>
              <input type="date" value={priceDate} onChange={(e) => setPriceDate(e.target.value)} />
            </div>
            <div>
              <label>Clean Price (%)</label>
              <input
                type="number"
                value={cleanPrice}
                onChange={(e) => setCleanPrice(e.target.value)}
                placeholder="e.g., 99.50"
                step="0.0001"
              />
            </div>
            <div>
              <label>Dirty Price (%) - Optional</label>
              <input
                type="number"
                value={dirtyPrice}
                onChange={(e) => setDirtyPrice(e.target.value)}
                placeholder="e.g., 100.25"
                step="0.0001"
              />
            </div>
            <div>
              <label>Yield (%) - Optional</label>
              <input
                type="number"
                value={yieldValue}
                onChange={(e) => setYieldValue(e.target.value)}
                placeholder="e.g., 8.50"
                step="0.0001"
              />
            </div>
          </div>
          <div className="actions" style={{ marginTop: "16px" }}>
            <button className="primary" onClick={handleAddPrice} disabled={saving}>
              {saving ? "Saving..." : "Add Price"}
            </button>
            <button className="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {showBulkUpload && (
        <section className="form-card">
          <h3>Bulk Price Upload</h3>
          <p className="footer-note" style={{ marginBottom: "16px" }}>
            Enter prices in CSV format: SYMBOL,CLEAN_PRICE,DIRTY_PRICE (one per line).
            Securities are matched by symbol or ISIN.
          </p>
          <div className="section-grid">
            <div>
              <label>Price Date</label>
              <input type="date" value={bulkPriceDate} onChange={(e) => setBulkPriceDate(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: "12px" }}>
            <label>Price Data</label>
            <textarea
              value={bulkData}
              onChange={(e) => setBulkData(e.target.value)}
              placeholder={`TBILL-2025-03-15,99.25,99.30\nGOVT-BOND-A,101.50,102.15\nLK0100A12345,98.75`}
              rows={8}
              style={{ fontFamily: "monospace", fontSize: "0.9rem" }}
            />
          </div>
          <div className="actions" style={{ marginTop: "16px" }}>
            <button className="primary" onClick={handleBulkUpload} disabled={bulkUploading}>
              {bulkUploading ? "Uploading..." : "Upload Prices"}
            </button>
            <button className="secondary" onClick={() => setShowBulkUpload(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Revaluation Section */}
      <section className="form-card" style={{ marginTop: "24px" }}>
        <h3>Revalue Collateral Positions</h3>
        <p className="footer-note" style={{ marginBottom: "16px" }}>
          Update collateral position market values using the latest available prices.
        </p>
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
          <div>
            <label>Valuation Date</label>
            <input
              type="date"
              value={revaluationDate}
              onChange={(e) => setRevaluationDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <button className="primary" onClick={handleRevalueCollateral} disabled={revaluing}>
            {revaluing ? "Revaluing..." : "Run Revaluation"}
          </button>
        </div>
      </section>

      {/* Price History */}
      <section style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2>Price History ({filteredPrices.length})</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label style={{ marginBottom: 0 }}>Filter Date:</label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              style={{ width: "150px" }}
            />
            <button className="ghost" onClick={() => setFilterDate("")}>
              Clear
            </button>
          </div>
        </div>

        {filteredPrices.length === 0 ? (
          <div className="allocation-row">
            <p>No prices found. Add prices using the buttons above.</p>
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Security</th>
                <th>Date</th>
                <th style={{ textAlign: "right" }}>Clean Price</th>
                <th style={{ textAlign: "right" }}>Dirty Price</th>
                <th style={{ textAlign: "right" }}>Yield</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrices.map((price) => (
                <tr key={price.id}>
                  <td>
                    <strong>{price.security_symbol}</strong>
                    <br />
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{price.security_name}</span>
                  </td>
                  <td>{formatDate(price.price_date)}</td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>{price.clean_price.toFixed(4)}</td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                    {price.dirty_price?.toFixed(4) ?? "-"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                    {price.yield?.toFixed(4) ?? "-"}
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.7rem",
                        backgroundColor: price.source === "MANUAL" ? "#dbeafe" : "#d1fae5",
                        color: price.source === "MANUAL" ? "#1d4ed8" : "#047857",
                      }}
                    >
                      {price.source}
                    </span>
                  </td>
                  <td>
                    <button className="ghost" onClick={() => handleDeletePrice(price.id)}>
                      Delete
                    </button>
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

