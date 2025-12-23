"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { RepoAllocation, RepoSeriesDraft } from "@/lib/types";

type Counterparty = { id: string; name: string };
type SecurityType = { id: string; name: string };
type Portfolio = { id: string; name: string };
type CashAccount = {
  id: string;
  portfolio_id: string;
  bank_name: string | null;
  account_no: string | null;
};
type CustodyAccount = {
  id: string;
  portfolio_id: string;
  provider: string;
  account_no: string;
};
type CollateralSecurity = { id: string; symbol: string; name: string | null };
type OrgOption = { id: string; name: string };

type ValidationResult = {
  valid: boolean;
  messages: string[];
};

type CollateralDraftLine = {
  id: string;
  allocationId: string;
  collateralSecurityId: string;
  faceValue: number;
  dirtyPrice: number | null;
  marketValue: number;
  haircutPct: number;
  valuationDate: string;
  externalCustodianRef: string;
};

const emptyAllocation = (portfolioId = ""): RepoAllocation => ({
  id: crypto.randomUUID(),
  portfolioId,
  principal: 0,
  reinvestInterest: true,
  capitalAdjustment: 0,
  cashAccountId: "",
  custodyAccountId: ""
});

export default function RepoEntryPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"ALLOCATIONS" | "COLLATERAL">(
    "ALLOCATIONS"
  );

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [securityTypes, setSecurityTypes] = useState<SecurityType[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [custodyAccounts, setCustodyAccounts] = useState<CustodyAccount[]>([]);
  const [defaultDayCountBasis, setDefaultDayCountBasis] = useState<
    360 | 365 | null
  >(null);
  const [collateralSecurities, setCollateralSecurities] = useState<
    CollateralSecurity[]
  >([]);

  const [draft, setDraft] = useState<RepoSeriesDraft>({
    orgId: "",
    counterpartyId: "",
    securityTypeId: "",
    symbol: "",
    issueDate: "",
    maturityDate: "",
    rate: "" as unknown as number, // Empty string for placeholder display
    dayCountBasis: null,
    notes: "",
    allocations: [emptyAllocation()]
  });
  const [collateralLines, setCollateralLines] = useState<
    CollateralDraftLine[]
  >([]);
  const [symbolWarning, setSymbolWarning] = useState<string | null>(null);

  useEffect(() => {
    setCollateralLines((prev) =>
      prev.filter((line) => draft.allocations.some((row) => row.id === line.allocationId))
    );
  }, [draft.allocations]);

  useEffect(() => {
    let isActive = true;

    const generateSymbol = async () => {
      const rateNum = Number(draft.rate);
      if (!draft.counterpartyId || !draft.issueDate || !draft.maturityDate || !rateNum || rateNum <= 0) {
        setSymbolWarning(null);
        setDraft((prev) => (prev.symbol ? { ...prev, symbol: "" } : prev));
        return;
      }

      const { data, error: symbolError } = await supabase.rpc("build_repo_symbol", {
        p_counterparty_id: draft.counterpartyId,
        p_issue_date: draft.issueDate,
        p_maturity_date: draft.maturityDate,
        p_rate: rateNum / 100
      });

      if (!isActive) return;

      if (symbolError) {
        setSymbolWarning("Auto-symbol failed; you can enter one manually.");
        return;
      }

      const generated = typeof data === "string" ? data : "";
      setSymbolWarning(null);
      setDraft((prev) => (prev.symbol === generated ? prev : { ...prev, symbol: generated }));
    };

    generateSymbol();

    return () => {
      isActive = false;
    };
  }, [draft.counterpartyId, draft.issueDate, draft.maturityDate, draft.rate]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);
      setValidationMessages([]);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to load repo data.");
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

      const memberRows =
        (memberData as Array<{
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
        setError("No organization membership found for this user.");
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
    const loadOrgData = async () => {
      if (!orgId) return;

      setLoading(true);
      setError(null);
      setValidationMessages([]);
      setSuccessMessage(null);

      const [
        counterpartyRes,
        securityTypeRes,
        portfolioRes,
        cashRes,
        custodyRes,
        securitiesRes,
        configRes
      ] = await Promise.all([
        supabase.from("counterparties").select("id, name").eq("org_id", orgId),
        supabase
          .from("security_types")
          .select("id, name")
          .eq("org_id", orgId)
          .eq("is_repo_type", true),
        supabase.from("portfolios").select("id, name").eq("org_id", orgId),
        supabase
          .from("cash_accounts")
          .select("id, portfolio_id, bank_name, account_no")
          .eq("org_id", orgId),
        supabase
          .from("custody_accounts")
          .select("id, portfolio_id, provider, account_no")
          .eq("org_id", orgId),
        supabase
          .from("securities")
          .select("id, symbol, name, security_types ( is_repo_type )")
          .eq("org_id", orgId)
          .eq("security_types.is_repo_type", false),
        supabase
          .from("config_settings")
          .select("default_day_count_basis")
          .eq("org_id", orgId)
          .single()
      ]);

      if (
        counterpartyRes.error ||
        securityTypeRes.error ||
        portfolioRes.error ||
        cashRes.error ||
        custodyRes.error ||
        securitiesRes.error
      ) {
        setError(
          counterpartyRes.error?.message ||
            securityTypeRes.error?.message ||
            portfolioRes.error?.message ||
            cashRes.error?.message ||
            custodyRes.error?.message ||
            securitiesRes.error?.message ||
            "Failed to load reference data."
        );
        setLoading(false);
        return;
      }

      if (configRes.error || !configRes.data?.default_day_count_basis) {
        setError("Config settings missing for this org. Please seed config_settings.");
        setLoading(false);
        return;
      }

      const basis = Number(configRes.data.default_day_count_basis) as 360 | 365;
      if (basis !== 360 && basis !== 365) {
        setError("Config settings include unsupported day count basis.");
        setLoading(false);
        return;
      }

      if (!counterpartyRes.data?.length) {
        setError("No counterparties found for this org.");
        setLoading(false);
        return;
      }

      if (!securityTypeRes.data?.length) {
        setError("No repo security types found for this org.");
        setLoading(false);
        return;
      }

      if (!portfolioRes.data?.length) {
        setError("No portfolios found for this org.");
        setLoading(false);
        return;
      }

      setDefaultDayCountBasis(basis);
      setCounterparties(counterpartyRes.data ?? []);
      setSecurityTypes(securityTypeRes.data ?? []);
      setPortfolios(portfolioRes.data ?? []);
      setCashAccounts(cashRes.data ?? []);
      setCustodyAccounts(custodyRes.data ?? []);
      const securitiesData = securitiesRes.data ?? [];
      setCollateralSecurities(
        (securitiesData as Array<{ id: string; symbol: string; name: string | null }>).map(
          (item) => ({ id: item.id, symbol: item.symbol, name: item.name })
        )
      );

      setDraft({
        orgId,
        counterpartyId: "",
        securityTypeId: "",
        symbol: "",
        issueDate: "",
        maturityDate: "",
        rate: "" as unknown as number,
        dayCountBasis: basis,
        notes: "",
        allocations: [emptyAllocation(portfolioRes.data?.[0]?.id)]
      });

      setLoading(false);
    };

    loadOrgData();
  }, [orgId]);

  const tenorDays = useMemo(() => {
    if (!draft.issueDate || !draft.maturityDate) return 0;
    const issue = new Date(draft.issueDate);
    const maturity = new Date(draft.maturityDate);
    const diff = maturity.getTime() - issue.getTime();
    return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
  }, [draft.issueDate, draft.maturityDate]);

  const totalPrincipal = useMemo(
    () => draft.allocations.reduce((sum, row) => sum + (row.principal || 0), 0),
    [draft.allocations]
  );

  // Calculate interest for a given principal amount
  const calculateInterest = (principal: number): number => {
    if (!tenorDays || !draft.rate || !draft.dayCountBasis || !principal) return 0;
    const rateDecimal = Number(draft.rate) / 100;
    return principal * rateDecimal * (tenorDays / draft.dayCountBasis);
  };

  const estimatedInterest = useMemo(() => {
    return calculateInterest(totalPrincipal);
  }, [draft.dayCountBasis, draft.rate, tenorDays, totalPrincipal]);

  // Calculate maturity value (principal + interest)
  const totalMaturityValue = useMemo(() => {
    return totalPrincipal + estimatedInterest;
  }, [totalPrincipal, estimatedInterest]);

  const updateAllocation = (id: string, updates: Partial<RepoAllocation>) => {
    setDraft((prev) => ({
      ...prev,
      allocations: prev.allocations.map((row) =>
        row.id === id ? { ...row, ...updates } : row
      )
    }));
  };

  const addAllocation = () => {
    setDraft((prev) => ({
      ...prev,
      allocations: [...prev.allocations, emptyAllocation(portfolios[0]?.id)]
    }));
  };

  const removeAllocation = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      allocations: prev.allocations.filter((row) => row.id !== id)
    }));
  };

  const addCollateralLine = () => {
    if (!draft.allocations.length) {
      setError("Add at least one allocation before capturing collateral.");
      return;
    }
    const allocationId = draft.allocations[0]?.id ?? "";
    const valuationFallback = draft.issueDate || new Date().toISOString().slice(0, 10);
    setCollateralLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        allocationId,
        collateralSecurityId: "",
        faceValue: 0,
        dirtyPrice: null,
        marketValue: 0,
        haircutPct: 0,
        valuationDate: valuationFallback,
        externalCustodianRef: ""
      }
    ]);
  };

  const updateCollateralLine = (
    id: string,
    updates: Partial<CollateralDraftLine>
  ) => {
    setCollateralLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...updates } : line))
    );
  };

  const removeCollateralLine = (id: string) => {
    setCollateralLines((prev) => prev.filter((line) => line.id !== id));
  };

  const validateDraft = (): ValidationResult => {
    const messages: string[] = [];

    if (!orgId) messages.push("Organization is required.");
    if (!draft.counterpartyId) messages.push("Counterparty is required.");
    if (!draft.securityTypeId) messages.push("Security type is required.");
    if (!draft.symbol.trim()) messages.push("Security symbol is required.");
    if (!draft.issueDate) messages.push("Issue date is required.");
    if (!draft.maturityDate) messages.push("Maturity date is required.");
    if (draft.issueDate && draft.maturityDate && tenorDays <= 0) {
      messages.push("Issue date must be earlier than maturity date.");
    }
    if (draft.rate <= 0) messages.push("Rate must be greater than zero.");
    if (!draft.dayCountBasis) messages.push("Day count basis is required.");

    if (!draft.allocations.length) {
      messages.push("At least one allocation is required.");
    }

    const seenClients = new Set<string>();
    draft.allocations.forEach((row, index) => {
      if (!row.portfolioId) {
        messages.push(`Allocation ${index + 1}: client is required.`);
      }
      if (row.principal <= 0) {
        messages.push(`Allocation ${index + 1}: principal must be positive.`);
      }
      if (row.portfolioId) {
        if (seenClients.has(row.portfolioId)) {
          messages.push(`Allocation ${index + 1}: duplicate client detected.`);
        }
        seenClients.add(row.portfolioId);
      }
    });

    collateralLines.forEach((line, index) => {
      if (!line.allocationId) {
        messages.push(`Collateral line ${index + 1}: allocation is required.`);
      }
      if (!line.collateralSecurityId) {
        messages.push(`Collateral line ${index + 1}: security is required.`);
      }
      if (line.faceValue <= 0 || line.marketValue <= 0) {
        messages.push(`Collateral line ${index + 1}: face and market value must be positive.`);
      }
      if (!line.valuationDate) {
        messages.push(`Collateral line ${index + 1}: valuation date is required.`);
      }
    });

    return { valid: messages.length === 0, messages };
  };

  const onSubmit = async () => {
    setValidationMessages([]);
    setError(null);
    setSuccessMessage(null);

    const validation = validateDraft();
    if (!validation.valid) {
      setValidationMessages(validation.messages);
      // Scroll to validation messages
      setTimeout(() => {
        document.getElementById('validation-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return;
    }

    if (!userId) {
      setError("User session not found. Please sign in again.");
      return;
    }

    if (!draft.dayCountBasis) {
      setError("Day count basis is missing.");
      return;
    }

    setSubmitting(true);

    try {
      const counterparty = counterparties.find(
        (item) => item.id === draft.counterpartyId
      );
      if (!counterparty) {
        throw new Error("Counterparty not found for this org.");
      }

      const securityName = `${counterparty.name} ${draft.issueDate} -> ${draft.maturityDate} @ ${draft.rate.toFixed(2)}%`;

      const { data: securityData, error: securityError } = await supabase
        .from("securities")
        .insert({
          org_id: orgId,
          security_type_id: draft.securityTypeId,
          symbol: draft.symbol.trim(),
          name: securityName,
          counterparty_id: draft.counterpartyId,
          issue_date: draft.issueDate,
          maturity_date: draft.maturityDate,
          rate: draft.rate / 100,
          day_count_basis: draft.dayCountBasis,
          status: "UNSUPERVISED",
          created_by: userId
        })
        .select("id")
        .single();

      if (securityError || !securityData) {
        throw new Error(securityError?.message ?? "Failed to create repo security.");
      }

      const { data: tradeData, error: tradeError } = await supabase
        .from("repo_trades")
        .insert({
          org_id: orgId,
          repo_security_id: securityData.id,
          counterparty_id: draft.counterpartyId,
          issue_date: draft.issueDate,
          maturity_date: draft.maturityDate,
          rate: draft.rate / 100,
          day_count_basis: draft.dayCountBasis,
          status: "DRAFT",
          created_by: userId,
          notes: draft.notes
        })
        .select("id")
        .single();

      if (tradeError || !tradeData) {
        throw new Error(tradeError?.message ?? "Failed to create repo trade.");
      }

      const allocationRows = draft.allocations.map((row) => ({
        org_id: orgId,
        repo_trade_id: tradeData.id,
        portfolio_id: row.portfolioId,
        cash_account_id: row.cashAccountId || null,
        custody_account_id: row.custodyAccountId || null,
        principal: row.principal,
        reinvest_interest: row.reinvestInterest,
        capital_adjustment: row.capitalAdjustment,
        status: "DRAFT"
      }));

      const { data: allocationData, error: allocationsError } = await supabase
        .from("repo_allocations")
        .insert(allocationRows)
        .select("id, portfolio_id");

      if (allocationsError || !allocationData) {
        throw new Error(allocationsError?.message ?? "Failed to create allocations.");
      }

      if (collateralLines.length) {
        const allocationByPortfolio = new Map<string, string>();
        allocationData.forEach((row) => {
          allocationByPortfolio.set(row.portfolio_id, row.id);
        });

        const portfolioByDraftId = new Map(
          draft.allocations.map((row) => [row.id, row.portfolioId])
        );

        const collateralRows = collateralLines.map((line) => {
          const portfolioId = portfolioByDraftId.get(line.allocationId);
          const allocationId = portfolioId
            ? allocationByPortfolio.get(portfolioId)
            : undefined;

          if (!allocationId || !portfolioId) {
            throw new Error("Failed to map collateral line to allocation.");
          }

          return {
            org_id: orgId,
            repo_allocation_id: allocationId,
            portfolio_id: portfolioId,
            collateral_security_id: line.collateralSecurityId,
            face_value: line.faceValue,
            dirty_price: line.dirtyPrice,
            market_value: line.marketValue,
            haircut_pct: line.haircutPct / 100,
            valuation_date: line.valuationDate,
            restricted_flag: true,
            status: "RECEIVED",
            external_custodian_ref: line.externalCustodianRef || null
          };
        });

        const { error: collateralError } = await supabase
          .from("collateral_positions")
          .insert(collateralRows);

        if (collateralError) {
          throw new Error(collateralError.message);
        }
      }

      setSuccessMessage("Repo draft saved. BO can now review and approve.");
      setDraft((prev) => ({
        ...prev,
        symbol: "",
        issueDate: "",
        maturityDate: "",
        rate: "" as unknown as number,
        notes: "",
        allocations: [emptyAllocation(portfolios[0]?.id)]
      }));
      setCollateralLines([]);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Submission failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const issueDateInvalid =
    draft.issueDate && draft.maturityDate && tenorDays <= 0;

  const cashOptionsFor = (portfolioId: string) =>
    cashAccounts.filter((account) => account.portfolio_id === portfolioId);

  const custodyOptionsFor = (portfolioId: string) =>
    custodyAccounts.filter((account) => account.portfolio_id === portfolioId);

  if (loading) {
    return (
      <main>
        <section>
          <h2>Loading repo workspace...</h2>
          <p>Fetching counterparties, portfolios, and configuration.</p>
        </section>
      </main>
    );
  }

  // Auth is handled by AppShell - just show error if any
  if (error === "Please sign in to load repo data.") {
    return null;
  }

  if (error) {
    return (
      <main>
        <section>
          <h2>Unable to load data</h2>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  // Check if symbol can be auto-generated
  const canGenerateSymbol = Boolean(
    draft.counterpartyId && draft.issueDate && draft.maturityDate && Number(draft.rate) > 0
  );

  return (
    <main>
      <section className="repo-details-section">
        <header className="section-header">
          <div>
            <div className="badge">Repo Placement • Draft</div>
            <h2>Repo Details</h2>
          </div>
          <button className="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit for Approval"}
          </button>
        </header>

        {/* Summary metrics at top */}
        <div className="summary-card inline-summary">
          <div className="summary-item">
            <label>Total Principal</label>
            <div>LKR {totalPrincipal.toLocaleString()}</div>
          </div>
          <div className="summary-item">
            <label>Tenor</label>
            <div>{tenorDays} days</div>
          </div>
          <div className="summary-item">
            <label>Estimated Interest</label>
            <div>LKR {estimatedInterest.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="summary-item highlight">
            <label>Maturity Value</label>
            <div>LKR {totalMaturityValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="summary-item">
            <label>Day Count</label>
            <div>{draft.dayCountBasis === 365 ? "ACT/365" : draft.dayCountBasis === 360 ? "ACT/360" : "-"}</div>
          </div>
        </div>

        {orgOptions.length > 1 && (
          <div className="section-grid">
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
          </div>
        )}
        <div className="section-grid">
          <div>
            <label>Counterparty</label>
            <select
              value={draft.counterpartyId}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  counterpartyId: event.target.value
                }))
              }
            >
              <option value="">Select counterparty</option>
              {counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Security Type</label>
            <select
              value={draft.securityTypeId}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  securityTypeId: event.target.value
                }))
              }
            >
              <option value="">Select repo security type</option>
              {securityTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Issue Date</label>
            <input
              type="date"
              value={draft.issueDate}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, issueDate: event.target.value }))
              }
            />
          </div>
          <div>
            <label>Maturity Date</label>
            <input
              type="date"
              value={draft.maturityDate}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  maturityDate: event.target.value
                }))
              }
            />
          </div>
          <div>
            <label>Rate (%)</label>
            <input
              type="number"
              value={draft.rate === ('' as unknown as number) ? '' : draft.rate}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  rate: event.target.value === '' ? ('' as unknown as number) : Number(event.target.value)
                }))
              }
              placeholder="Enter rate"
              min={0}
              step={0.01}
            />
          </div>
          <div>
            <label>Day Count Convention</label>
            <select
              value={draft.dayCountBasis ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  dayCountBasis: Number(event.target.value) as 360 | 365
                }))
              }
            >
              <option value="">Select convention</option>
              <option value="365">ACT/365</option>
              <option value="360">ACT/360</option>
            </select>
          </div>
          <div>
            <label>Notes</label>
            <textarea
              value={draft.notes}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Optional trade note"
            />
          </div>
          {/* Symbol field - placed last since it's auto-generated */}
          <div className="symbol-field">
            <label>Symbol {canGenerateSymbol ? "(Auto-generated)" : ""}</label>
            <input
              value={draft.symbol}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, symbol: event.target.value }))
              }
              placeholder={canGenerateSymbol ? "Generating..." : "Fill fields above to generate"}
              readOnly={canGenerateSymbol && !symbolWarning}
              className={canGenerateSymbol && draft.symbol ? "auto-generated" : ""}
            />
            {symbolWarning && <p className="footer-note">{symbolWarning}</p>}
          </div>
        </div>
        {issueDateInvalid && (
          <p className="footer-note">
            Issue date must be earlier than maturity date.
          </p>
        )}
      </section>

      <section className="allocations">
        <h2>Client Allocations</h2>
        {draft.allocations.map((row, index) => (
          <div className="allocation-row" key={row.id}>
            <div className="row-grid">
              <div>
                <label>Client</label>
                <select
                  value={row.portfolioId}
                  onChange={(event) =>
                    updateAllocation(row.id, {
                      portfolioId: event.target.value,
                      cashAccountId: "",
                      custodyAccountId: ""
                    })
                  }
                >
                  <option value="">Select client</option>
                  {portfolios.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Principal (LKR)</label>
                <input
                  type="number"
                  value={row.principal || ''}
                  onChange={(event) =>
                    updateAllocation(row.id, {
                      principal: Number(event.target.value) || 0
                    })
                  }
                  placeholder="Enter amount"
                  min={0}
                  step={1000}
                />
              </div>
              <div>
                <label>Interest (LKR)</label>
                <input
                  type="text"
                  value={calculateInterest(row.principal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  readOnly
                  className="computed-value"
                />
              </div>
              <div>
                <label>Maturity Value (LKR)</label>
                <input
                  type="text"
                  value={(row.principal + calculateInterest(row.principal)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  readOnly
                  className="computed-value highlight-value"
                />
              </div>
              <div>
                <label>Capital Adjustment</label>
                <input
                  type="text"
                  value="NA"
                  readOnly
                  className="disabled-input"
                />
              </div>
              <div>
                <label>Cash Account</label>
                <select
                  value={row.cashAccountId ?? ""}
                  onChange={(event) =>
                    updateAllocation(row.id, {
                      cashAccountId: event.target.value
                    })
                  }
                >
                  <option value="">Select cash account</option>
                  {cashOptionsFor(row.portfolioId).map((account) => {
                    const labelParts = [
                      account.bank_name,
                      account.account_no
                    ].filter(Boolean);
                    const label = labelParts.length
                      ? labelParts.join(" - ")
                      : account.id;
                    return (
                      <option key={account.id} value={account.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label>Custody Account</label>
                <select
                  value={row.custodyAccountId ?? ""}
                  onChange={(event) =>
                    updateAllocation(row.id, {
                      custodyAccountId: event.target.value
                    })
                  }
                >
                  <option value="">Select custody account</option>
                  {custodyOptionsFor(row.portfolioId).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.provider} - {account.account_no}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => removeAllocation(row.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <button className="secondary" onClick={addAllocation}>
          Add Another Client
        </button>
      </section>

      {validationMessages.length > 0 && (
        <section id="validation-section" className="validation-errors">
          <h2>⚠️ Validation Issues</h2>
          <ul>
            {validationMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </section>
      )}

      {successMessage && (
        <section>
          <h2>Saved</h2>
          <p>{successMessage}</p>
        </section>
      )}
    </main>
  );
}
