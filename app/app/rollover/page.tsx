"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrgOption = { id: string; name: string };
type Portfolio = { id: string; name: string };
type Counterparty = { id: string; name: string };
type SecurityType = { id: string; name: string };
type PortfolioGroup = { id: string; name: string };
type PortfolioGroupMember = { group_id: string; portfolio_id: string };
type ConfigSettings = {
  day_count_method: string;
  include_maturity: boolean;
  use_holiday_calendar: boolean;
  holiday_roll: string;
};
type UserRole = "FO_TRADER" | "BO_OPERATIONS" | "RISK_COMPLIANCE" | "OPS_SUPERVISOR" | "READ_ONLY";
type Holiday = {
  id: string;
  holiday_date: string;
  description: string | null;
};

type RepoTradeOption = {
  id: string;
  label: string;
  symbol: string | null;
};

type BatchItem = {
  id: string;
  status: string;
  error_message: string | null;
  new_invest_amount: number;
  principal: number;
  interest: number;
  reinvest_interest: boolean;
  maturity_proceeds: number;
  capital_adjustment: number;
  collateral_mode: string;
  collateral_status: string | null;
  new_repo_allocation_id: string | null;
  portfolio: { name: string } | null;
};

type Mode = "MASS" | "SINGLE";

export default function RolloverPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [batchId, setBatchId] = useState<string>("");
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);

  const [mode, setMode] = useState<Mode>("MASS");
  const [rolloverDate, setRolloverDate] = useState<string>("");
  const [portfolioIds, setPortfolioIds] = useState<string[]>([]);
  const [oldRepoTradeId, setOldRepoTradeId] = useState<string>("");
  const [oldRepoTrades, setOldRepoTrades] = useState<RepoTradeOption[]>([]);

  const [newRate, setNewRate] = useState<string>("");
  const [newMaturityDate, setNewMaturityDate] = useState<string>("");
  const [newCounterpartyId, setNewCounterpartyId] = useState<string>("");
  const [newSecurityTypeId, setNewSecurityTypeId] = useState<string>("");
  const [collateralMode, setCollateralMode] = useState<string>("REUSE");
  const [amountOverride, setAmountOverride] = useState<string>("");

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [securityTypes, setSecurityTypes] = useState<SecurityType[]>([]);
  const [portfolioGroups, setPortfolioGroups] = useState<PortfolioGroup[]>([]);
  const [portfolioGroupMembers, setPortfolioGroupMembers] = useState<PortfolioGroupMember[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [configSettings, setConfigSettings] = useState<ConfigSettings | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState<string>("");
  const [holidayDescription, setHolidayDescription] = useState<string>("");

  const [batchStatus, setBatchStatus] = useState<string>("");
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (mode === "SINGLE" && portfolioIds.length > 1) {
      setPortfolioIds([portfolioIds[0]]);
    }
    if (mode === "SINGLE" && groupId) {
      setGroupId("");
    }
    if (mode !== "SINGLE") {
      setOldRepoTradeId("");
      setOldRepoTrades([]);
    }
  }, [mode, portfolioIds, groupId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to access rollovers.");
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

  useEffect(() => {
    const loadOrgData = async () => {
      if (!orgId) return;

      setLoading(true);
      setError(null);
      setSuccessMessage(null);
      setBatchId("");
      setBatchItems([]);
      setBatchStatus("");
      setBatchCounts({});

      const [
        portfolioRes,
        counterpartyRes,
        securityTypeRes,
        configRes,
        holidayRes,
        roleRes,
        groupRes,
        groupMemberRes
      ] = await Promise.all([
        supabase.from("portfolios").select("id, name").eq("org_id", orgId),
        supabase.from("counterparties").select("id, name").eq("org_id", orgId),
        supabase
          .from("security_types")
          .select("id, name")
          .eq("org_id", orgId)
          .eq("is_repo_type", true),
        supabase
          .from("config_settings")
          .select("day_count_method, include_maturity, use_holiday_calendar, holiday_roll")
          .eq("org_id", orgId)
          .single(),
        supabase
          .from("org_holidays")
          .select("id, holiday_date, description")
          .eq("org_id", orgId)
          .order("holiday_date", { ascending: true }),
        userId
          ? supabase
              .from("org_members")
              .select("role")
              .eq("org_id", orgId)
              .eq("user_id", userId)
              .single()
          : Promise.resolve({ data: null, error: null }),
        supabase.from("portfolio_groups").select("id, name").eq("org_id", orgId),
        supabase
          .from("portfolio_group_members")
          .select("group_id, portfolio_id")
          .eq("org_id", orgId)
      ]);

      if (
        portfolioRes.error ||
        counterpartyRes.error ||
        securityTypeRes.error ||
        configRes.error ||
        holidayRes.error ||
        roleRes.error ||
        groupRes.error ||
        groupMemberRes.error
      ) {
        setError(
          portfolioRes.error?.message ||
            counterpartyRes.error?.message ||
            securityTypeRes.error?.message ||
            configRes.error?.message ||
            holidayRes.error?.message ||
            roleRes.error?.message ||
            groupRes.error?.message ||
            groupMemberRes.error?.message ||
            "Failed to load rollover reference data."
        );
        setLoading(false);
        return;
      }

      setPortfolios(portfolioRes.data ?? []);
      setCounterparties(counterpartyRes.data ?? []);
      setSecurityTypes(securityTypeRes.data ?? []);
      setConfigSettings(configRes.data as ConfigSettings);
      setHolidays((holidayRes.data as Holiday[]) ?? []);
      setUserRole((roleRes.data?.role as UserRole) ?? null);
      setPortfolioGroups((groupRes.data as PortfolioGroup[]) ?? []);
      setPortfolioGroupMembers((groupMemberRes.data as PortfolioGroupMember[]) ?? []);
      setPortfolioIds([]);
      setGroupId("");
      setLoading(false);
    };

    loadOrgData();
  }, [orgId, userId]);

  const selectedPortfolioNames = useMemo(() => {
    const lookup = new Map(portfolios.map((p) => [p.id, p.name]));
    return portfolioIds.map((id) => lookup.get(id) ?? id);
  }, [portfolioIds, portfolios]);

  const hasExecuteRole =
    userRole === "BO_OPERATIONS" || userRole === "OPS_SUPERVISOR";

  const groupPortfolioIds = useMemo(() => {
    if (!groupId) return [];
    return portfolioGroupMembers
      .filter((member) => member.group_id === groupId)
      .map((member) => member.portfolio_id);
  }, [groupId, portfolioGroupMembers]);

  useEffect(() => {
    if (groupId) {
      setPortfolioIds(groupPortfolioIds);
    }
  }, [groupId, groupPortfolioIds]);

  useEffect(() => {
    const loadOldRepoTrades = async () => {
      if (mode !== "SINGLE" || !orgId || !rolloverDate || portfolioIds.length !== 1) {
        setOldRepoTrades([]);
        setOldRepoTradeId("");
        return;
      }

      const portfolioId = portfolioIds[0];
      const { data, error: tradeError } = await supabase
        .from("repo_allocations")
        .select(
          "repo_trade_id, repo_trades ( id, issue_date, maturity_date, rate, counterparties ( name ), securities ( symbol ) )"
        )
        .eq("org_id", orgId)
        .eq("portfolio_id", portfolioId)
        .in("status", ["ACTIVE", "POSTED"])
        .eq("repo_trades.maturity_date", rolloverDate);

      if (tradeError) {
        setOldRepoTrades([]);
        setOldRepoTradeId("");
        return;
      }

      const tradeMap = new Map<string, RepoTradeOption>();
      (data as Array<{
        repo_trade_id: string | null;
        repo_trades?: {
          id?: string;
          issue_date?: string;
          maturity_date?: string;
          rate?: number;
          counterparties?: { name?: string } | null;
          securities?: { symbol?: string } | null;
        } | null;
      }>).forEach((row) => {
        const trade = row.repo_trades;
        if (!trade?.id) return;
        const symbol = trade.securities?.symbol ?? null;
        const ratePct = trade.rate ? (trade.rate * 100).toFixed(2) : "0.00";
        const label = `${symbol ?? "REPO"} • ${trade.counterparties?.name ?? "Counterparty"} • ${
          trade.issue_date ?? "?"
        } -> ${trade.maturity_date ?? "?"} @ ${ratePct}%`;
        tradeMap.set(trade.id, { id: trade.id, label, symbol });
      });

      const options = Array.from(tradeMap.values());
      setOldRepoTrades(options);
      setOldRepoTradeId((prev) => {
        if (options.length === 1) return options[0].id;
        return options.some((option) => option.id === prev) ? prev : "";
      });
    };

    loadOldRepoTrades();
  }, [mode, orgId, rolloverDate, portfolioIds]);

  const totals = useMemo(() => {
    return batchItems.reduce(
      (acc, item) => {
        acc.principal += item.principal || 0;
        acc.interest += item.interest || 0;
        acc.maturity += item.maturity_proceeds || 0;
        acc.newInvest += item.new_invest_amount || 0;
        acc.capital += item.capital_adjustment || 0;
        return acc;
      },
      {
        principal: 0,
        interest: 0,
        maturity: 0,
        newInvest: 0,
        capital: 0
      }
    );
  }, [batchItems]);

  const rollup = useMemo(() => {
    return batchItems.reduce(
      (acc, item) => {
        if (item.status !== "SUCCESS" && item.status !== "SKIPPED") {
          return acc;
        }
        acc.closedCount += 1;
        if (item.status === "SUCCESS" && item.new_invest_amount > 0) {
          acc.openedCount += 1;
        }
        acc.maturity += item.maturity_proceeds || 0;
        acc.newInvest += item.new_invest_amount || 0;
        if (!item.reinvest_interest) {
          acc.interestWithdrawn += item.interest || 0;
        }
        return acc;
      },
      {
        closedCount: 0,
        openedCount: 0,
        maturity: 0,
        newInvest: 0,
        interestWithdrawn: 0
      }
    );
  }, [batchItems]);

  const portfolioReport = useMemo(() => {
    const grouped = new Map<
      string,
      {
        principal: number;
        interest: number;
        maturity: number;
        newInvest: number;
        capital: number;
      }
    >();

    batchItems.forEach((item) => {
      const key = item.portfolio?.name ?? "Portfolio";
      const current = grouped.get(key) || {
        principal: 0,
        interest: 0,
        maturity: 0,
        newInvest: 0,
        capital: 0
      };
      current.principal += item.principal || 0;
      current.interest += item.interest || 0;
      current.maturity += item.maturity_proceeds || 0;
      current.newInvest += item.new_invest_amount || 0;
      current.capital += item.capital_adjustment || 0;
      grouped.set(key, current);
    });

    return Array.from(grouped.entries());
  }, [batchItems]);

  const validate = () => {
    const effectivePortfolioIds =
      groupId && groupPortfolioIds.length ? groupPortfolioIds : portfolioIds;
    if (!orgId) return "Organization is required.";
    if (!rolloverDate) return "Rollover date is required.";
    if (mode === "SINGLE" && effectivePortfolioIds.length !== 1) {
      return "Single rollover requires exactly one portfolio.";
    }
    if (mode === "SINGLE" && !oldRepoTradeId) {
      return "Single rollover requires selecting the old repo series.";
    }
    if (amountOverride && effectivePortfolioIds.length !== 1) {
      return "Amount override requires a single portfolio selection.";
    }
    return null;
  };

  const buildParams = () => {
    const params: Record<string, string | number> = {};
    if (newRate) params.new_rate = Number(newRate) / 100;
    if (newMaturityDate) params.new_maturity_date = newMaturityDate;
    if (newCounterpartyId) params.new_counterparty_id = newCounterpartyId;
    if (newSecurityTypeId) params.new_security_type_id = newSecurityTypeId;
    if (collateralMode) params.collateral_mode = collateralMode;
    if (amountOverride) params.amount_override = Number(amountOverride);
    if (groupId) params.group_id = groupId;
    if (oldRepoTradeId) params.old_repo_trade_id = oldRepoTradeId;
    return params;
  };

  const handleCreateBatch = async () => {
    setError(null);
    setSuccessMessage(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const params = buildParams();
    const { data, error: createError } = await supabase.rpc("create_rollover_batch", {
      p_org_id: orgId,
      p_mode: mode,
      p_rollover_date: rolloverDate,
      p_portfolio_ids: groupId ? null : portfolioIds.length ? portfolioIds : null,
      p_params: params
    });

    if (createError) {
      setError(createError.message);
      return;
    }

    const id = data as string;
    setBatchId(id);
    await loadBatchMeta(id);
    setSuccessMessage("Rollover batch created. Build items to preview.");
  };

  const handleBuildItems = async () => {
    if (!batchId) {
      setError("Create a batch first.");
      return;
    }
    setError(null);
    setSuccessMessage(null);

    const { error: buildError } = await supabase.rpc("build_rollover_batch_items", {
      p_batch_id: batchId
    });

    if (buildError) {
      setError(buildError.message);
      return;
    }

    await Promise.all([loadBatchItems(batchId), loadBatchMeta(batchId)]);
    setSuccessMessage("Batch items generated.");
  };

  const handleSubmitBatch = async () => {
    if (!batchId) {
      setError("Create a batch first.");
      return;
    }
    setError(null);
    setSuccessMessage(null);

    const { error: submitError } = await supabase.rpc("submit_rollover_batch", {
      p_batch_id: batchId
    });

    if (submitError) {
      setError(submitError.message);
      return;
    }

    await loadBatchMeta(batchId);
    setSuccessMessage("Batch submitted for approval.");
  };

  const handleApproveBatch = async () => {
    if (!batchId) {
      setError("Create a batch first.");
      return;
    }
    setError(null);
    setSuccessMessage(null);

    const { error: approveError } = await supabase.rpc("approve_rollover_batch", {
      p_batch_id: batchId
    });

    if (approveError) {
      setError(approveError.message);
      return;
    }

    await loadBatchMeta(batchId);
    setSuccessMessage("Batch approved. You can now execute.");
  };

  const loadBatchItems = async (targetBatchId: string) => {
    const { data, error: itemsError } = await supabase
      .from("rollover_batch_items")
      .select(
        "id, status, error_message, principal, interest, reinvest_interest, maturity_proceeds, capital_adjustment, new_invest_amount, collateral_mode, collateral_status, new_repo_allocation_id, portfolio:portfolios(name)"
      )
      .eq("batch_id", targetBatchId)
      .order("created_at", { ascending: true });

    if (itemsError) {
      setError(itemsError.message);
      return;
    }

    setBatchItems((data as unknown as BatchItem[]) ?? []);
  };

  const loadBatchMeta = async (targetBatchId: string) => {
    const { data, error: batchError } = await supabase
      .from("rollover_batches")
      .select("status")
      .eq("id", targetBatchId)
      .single();

    if (batchError) {
      setError(batchError.message);
      return;
    }

    const { data: countsData, error: countsError } = await supabase
      .from("rollover_batch_items")
      .select("status")
      .eq("batch_id", targetBatchId);

    if (countsError) {
      setError(countsError.message);
      return;
    }

    const counts = (countsData as Array<{ status: string }> | null)?.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    setBatchStatus(data?.status ?? "");
    setBatchCounts(counts ?? {});
  };

  const handleExecuteBatch = async () => {
    if (!batchId) {
      setError("Create a batch first.");
      return;
    }
    setError(null);
    setSuccessMessage(null);

    const { error: execError } = await supabase.rpc("execute_rollover_batch", {
      p_batch_id: batchId
    });

    if (execError) {
      setError(execError.message);
      return;
    }

    await Promise.all([loadBatchItems(batchId), loadBatchMeta(batchId)]);
    setSuccessMessage("Batch executed. Review item results.");
  };

  const escapeCsv = (value: string | number | null) => {
    const str = value === null || value === undefined ? "" : String(value);
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const handleExportCsv = () => {
    if (!batchItems.length) return;

    const headers = [
      "portfolio",
      "principal",
      "interest",
      "reinvest_interest",
      "maturity_proceeds",
      "capital_adjustment",
      "new_invest_amount",
      "net_cash_delta",
      "status",
      "error_message"
    ];

    const rows = batchItems.map((item) => [
      item.portfolio?.name ?? "Portfolio",
      item.principal,
      item.interest,
      item.reinvest_interest ? "YES" : "NO",
      item.maturity_proceeds,
      item.capital_adjustment,
      item.new_invest_amount,
      item.new_invest_amount - item.maturity_proceeds,
      item.status,
      item.error_message ?? ""
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rollover_batch_${batchId || "export"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleToggleHolidayConfig = async (updates: Partial<ConfigSettings>) => {
    if (!configSettings) return;
    setError(null);

    const next = { ...configSettings, ...updates };
    const { error: updateError } = await supabase
      .from("config_settings")
      .update({
        day_count_method: next.day_count_method,
        include_maturity: next.include_maturity,
        use_holiday_calendar: next.use_holiday_calendar,
        holiday_roll: next.holiday_roll
      })
      .eq("org_id", orgId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setConfigSettings(next);
  };

  const handleAddHoliday = async () => {
    if (!holidayDate) {
      setError("Holiday date is required.");
      return;
    }
    setError(null);

    const { error: insertError } = await supabase.from("org_holidays").insert({
      org_id: orgId,
      holiday_date: holidayDate,
      description: holidayDescription || null
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const { data: holidayRes, error: holidayError } = await supabase
      .from("org_holidays")
      .select("id, holiday_date, description")
      .eq("org_id", orgId)
      .order("holiday_date", { ascending: true });

    if (holidayError) {
      setError(holidayError.message);
      return;
    }

    setHolidays((holidayRes as Holiday[]) ?? []);
    setHolidayDate("");
    setHolidayDescription("");
  };

  const handleRemoveHoliday = async (holidayId: string) => {
    setError(null);
    const { error: deleteError } = await supabase
      .from("org_holidays")
      .delete()
      .eq("id", holidayId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setHolidays((prev) => prev.filter((holiday) => holiday.id !== holidayId));
  };

  const togglePortfolio = (id: string) => {
    if (mode === "SINGLE") {
      setPortfolioIds([id]);
      return;
    }
    setPortfolioIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  if (loading) {
    return (
      <main>
        <section>
          <h2>Loading...</h2>
          <p>Preparing rollover workspace.</p>
        </section>
      </main>
    );
  }

  if (error === "Please sign in to access rollovers.") {
    return (
      <main>
        <section>
          <h2>Please sign in</h2>
          <p>Authentication is required to run rollovers.</p>
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
          <a href="/" className="back-link">
            ← Back to Entry
          </a>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div className="badge">Rollover Console</div>
            <div className={`badge ${hasExecuteRole ? "badge-bo" : ""}`}>
              {hasExecuteRole ? "BO/OPS Execution" : "View Only"}
            </div>
          </div>
          <h1>Mass & Single Rollovers</h1>
          <p>Prepare, validate, and execute rollover batches.</p>
        </div>
        <button
          className="primary"
          onClick={handleExecuteBatch}
          disabled={!batchId || !hasExecuteRole || batchStatus !== "APPROVED"}
        >
          Execute Batch
        </button>
      </header>

      {!hasExecuteRole && (
        <section className="info-banner">
          <p>👁️ Execution is restricted to BO_OPERATIONS or OPS_SUPERVISOR roles.</p>
        </section>
      )}

      <section>
        <h2>Batch Setup</h2>
        <div className="section-grid">
          {orgOptions.length > 1 && (
            <div>
              <label>Organization</label>
              <select value={orgId} onChange={(event) => setOrgId(event.target.value)}>
                {orgOptions.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label>Mode</label>
            <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
              <option value="MASS">Mass</option>
              <option value="SINGLE">Single</option>
            </select>
          </div>
          <div>
            <label>Rollover Date</label>
            <input
              type="date"
              value={rolloverDate}
              onChange={(event) => setRolloverDate(event.target.value)}
            />
          </div>
        </div>
      </section>

      {batchId && (
        <section>
          <h2>Batch Summary</h2>
          <div className="summary-card">
            <div className="summary-item">
              <label>Status</label>
              <div>{batchStatus || "DRAFT"}</div>
            </div>
            <div className="summary-item">
              <label>Items</label>
              <div>{batchItems.length}</div>
            </div>
            <div className="summary-item">
              <label>Success</label>
              <div>{batchCounts.SUCCESS ?? 0}</div>
            </div>
            <div className="summary-item">
              <label>Failed</label>
              <div>{batchCounts.FAILED ?? 0}</div>
            </div>
            <div className="summary-item">
              <label>Skipped</label>
              <div>{batchCounts.SKIPPED ?? 0}</div>
            </div>
          </div>
          <div className="actions" style={{ marginTop: "16px" }}>
            <button
              className="secondary"
              onClick={handleSubmitBatch}
              disabled={!batchId || batchStatus !== "DRAFT"}
            >
              Submit for Approval
            </button>
            <button
              className="primary"
              onClick={handleApproveBatch}
              disabled={!batchId || !hasExecuteRole || batchStatus !== "SUBMITTED"}
            >
              Approve Batch
            </button>
          </div>
        </section>
      )}

      <section className="allocations">
        <h2>Portfolio Selection</h2>
        {mode === "MASS" && portfolioGroups.length > 0 && (
          <div className="section-grid">
            <div>
              <label>Portfolio Group</label>
              <select
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                <option value="">Select group (optional)</option>
                {portfolioGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="row-grid">
          {portfolios.map((portfolio) => (
            <label key={portfolio.id} style={{ textTransform: "none" }}>
              <input
                type="checkbox"
                checked={portfolioIds.includes(portfolio.id)}
                onChange={() => togglePortfolio(portfolio.id)}
                disabled={Boolean(groupId)}
                style={{ marginRight: "8px" }}
              />
              {portfolio.name}
            </label>
          ))}
        </div>
        {portfolioIds.length > 0 && (
          <p className="footer-note">Selected: {selectedPortfolioNames.join(", ")}</p>
        )}
        {mode === "SINGLE" && (
          <div className="section-grid" style={{ marginTop: "16px" }}>
            <div>
              <label>Old Repo Series</label>
              <select
                value={oldRepoTradeId}
                onChange={(event) => setOldRepoTradeId(event.target.value)}
                disabled={!rolloverDate || portfolioIds.length !== 1}
              >
                <option value="">Select repo series</option>
                {oldRepoTrades.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {rolloverDate && portfolioIds.length === 1 && oldRepoTrades.length === 0 && (
                <p className="footer-note">No eligible repo series for this portfolio/date.</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>Overrides</h2>
        <div className="section-grid">
          <div>
            <label>New Rate (%)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={newRate}
              onChange={(event) => setNewRate(event.target.value)}
            />
          </div>
          <div>
            <label>New Maturity Date</label>
            <input
              type="date"
              value={newMaturityDate}
              onChange={(event) => setNewMaturityDate(event.target.value)}
            />
          </div>
          <div>
            <label>New Counterparty</label>
            <select
              value={newCounterpartyId}
              onChange={(event) => setNewCounterpartyId(event.target.value)}
            >
              <option value="">Keep existing</option>
              {counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>New Security Type</label>
            <select
              value={newSecurityTypeId}
              onChange={(event) => setNewSecurityTypeId(event.target.value)}
            >
              <option value="">Keep existing</option>
              {securityTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Collateral Mode</label>
            <select
              value={collateralMode}
              onChange={(event) => setCollateralMode(event.target.value)}
            >
              <option value="REUSE">Reuse</option>
              <option value="REPLACE">Replace</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
          <div>
            <label>Amount Override (LKR)</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={amountOverride}
              onChange={(event) => setAmountOverride(event.target.value)}
            />
          </div>
        </div>
        <div className="actions">
          <button className="secondary" onClick={handleCreateBatch}>
            Create Batch
          </button>
          <button className="primary" onClick={handleBuildItems} disabled={!batchId}>
            Build Items
          </button>
        </div>
      </section>

      <section>
        <h2>Preview Totals</h2>
        {batchItems.length === 0 ? (
          <p>Build batch items to preview totals.</p>
        ) : (
          <div className="summary-card">
            <div className="summary-item">
              <label>Total Principal</label>
              <div>LKR {totals.principal.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <label>Total Interest</label>
              <div>LKR {totals.interest.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <label>Maturity Proceeds</label>
              <div>LKR {totals.maturity.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <label>New Invest</label>
              <div>LKR {totals.newInvest.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <label>Capital Adjustment</label>
              <div>LKR {totals.capital.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <label>Net Cash Delta</label>
              <div>
                LKR {(totals.newInvest - totals.maturity).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>Holiday Calendar</h2>
        <div className="section-grid">
          <div>
            <label>Day Count Method</label>
            <select
              value={configSettings?.day_count_method ?? "ACT/365"}
              onChange={(event) =>
                handleToggleHolidayConfig({ day_count_method: event.target.value })
              }
            >
              <option value="ACT/365">ACT/365</option>
              <option value="ACT/360">ACT/360</option>
              <option value="30/360">30/360</option>
            </select>
          </div>
          <div>
            <label>Include Maturity</label>
            <select
              value={configSettings?.include_maturity ? "yes" : "no"}
              onChange={(event) =>
                handleToggleHolidayConfig({ include_maturity: event.target.value === "yes" })
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
          <div>
            <label>Use Holiday Calendar</label>
            <select
              value={configSettings?.use_holiday_calendar ? "yes" : "no"}
              onChange={(event) =>
                handleToggleHolidayConfig({ use_holiday_calendar: event.target.value === "yes" })
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
          <div>
            <label>Holiday Roll</label>
            <select
              value={configSettings?.holiday_roll ?? "FOLLOWING"}
              onChange={(event) =>
                handleToggleHolidayConfig({ holiday_roll: event.target.value })
              }
            >
              <option value="FOLLOWING">Following</option>
              <option value="PRECEDING">Preceding</option>
            </select>
          </div>
        </div>
        <div className="section-grid" style={{ marginTop: "16px" }}>
          <div>
            <label>Holiday Date</label>
            <input
              type="date"
              value={holidayDate}
              onChange={(event) => setHolidayDate(event.target.value)}
            />
          </div>
          <div>
            <label>Description</label>
            <input
              value={holidayDescription}
              onChange={(event) => setHolidayDescription(event.target.value)}
              placeholder="Optional note"
            />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button className="secondary" onClick={handleAddHoliday}>
              Add Holiday
            </button>
          </div>
        </div>
        {holidays.length === 0 ? (
          <p className="footer-note">No holidays configured yet.</p>
        ) : (
          <div className="allocations">
            {holidays.map((holiday) => (
              <div key={holiday.id} className="allocation-row">
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <div>
                    <strong>{holiday.holiday_date}</strong>
                    {holiday.description && <p>{holiday.description}</p>}
                  </div>
                  <button className="ghost" onClick={() => handleRemoveHoliday(holiday.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {batchId && (
        <section>
          <h2>Batch Items</h2>
          {batchItems.length === 0 ? (
            <p>No items loaded yet.</p>
          ) : (
            <div className="allocations">
              {batchItems.map((item) => (
                <div key={item.id} className="allocation-row">
                  <div>
                    <strong>{item.portfolio?.name ?? "Portfolio"}</strong>
                  </div>
                  <p>Status: {item.status}</p>
                  <p>New Invest Amount: LKR {item.new_invest_amount.toLocaleString()}</p>
                  {item.collateral_mode !== "REUSE" && (
                    <p>Collateral Mode: {item.collateral_mode}</p>
                  )}
                  {item.collateral_status && item.collateral_mode !== "REUSE" && (
                    <p>Collateral Status: {item.collateral_status}</p>
                  )}
                  {item.error_message && <p>Note: {item.error_message}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {batchItems.length > 0 && (
        <section>
          <h2>Collateral Actions</h2>
          {batchItems.filter((item) => item.collateral_mode !== "REUSE").length === 0 ? (
            <p>No collateral actions required for this batch.</p>
          ) : (
            <div className="allocations">
              {batchItems
                .filter((item) => item.collateral_mode !== "REUSE")
                .map((item) => (
                  <div key={item.id} className="allocation-row">
                  <div>
                    <strong>{item.portfolio?.name ?? "Portfolio"}</strong>
                  </div>
                  <p>Collateral Mode: {item.collateral_mode}</p>
                  {item.collateral_status && <p>Status: {item.collateral_status}</p>}
                  {item.error_message && <p>Note: {item.error_message}</p>}
                    {item.new_repo_allocation_id ? (
                      <div className="actions">
                        <a
                          className="secondary"
                          href={`/collateral?allocation_id=${item.new_repo_allocation_id}`}
                        >
                          Add Collateral
                        </a>
                      </div>
                    ) : (
                      <p className="footer-note">New allocation not available yet.</p>
                    )}
                  </div>
                ))}
            </div>
          )}
        </section>
      )}

      {batchItems.length > 0 && (
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
            <h2>Batch Results Report</h2>
            <button className="secondary" onClick={handleExportCsv}>
              Export CSV
            </button>
          </div>
          <div className="summary-card" style={{ marginTop: "12px" }}>
            <div className="summary-item">
              <label>Closed Allocations</label>
              <div>{rollup.closedCount}</div>
            </div>
            <div className="summary-item">
              <label>Opened Allocations</label>
              <div>{rollup.openedCount}</div>
            </div>
            <div className="summary-item">
              <label>Interest Withdrawn</label>
              <div>LKR {rollup.interestWithdrawn.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <label>Net Cash Delta</label>
              <div>LKR {(rollup.newInvest - rollup.maturity).toLocaleString()}</div>
            </div>
          </div>
          <div className="allocations">
            {portfolioReport.map(([name, data]) => (
              <div key={name} className="allocation-row">
                <div>
                  <strong>{name}</strong>
                </div>
                <div className="row-grid" style={{ marginTop: "12px" }}>
                  <div>
                    <label>Principal</label>
                    <div>LKR {data.principal.toLocaleString()}</div>
                  </div>
                  <div>
                    <label>Interest</label>
                    <div>LKR {data.interest.toLocaleString()}</div>
                  </div>
                  <div>
                    <label>Maturity Proceeds</label>
                    <div>LKR {data.maturity.toLocaleString()}</div>
                  </div>
                  <div>
                    <label>New Invest</label>
                    <div>LKR {data.newInvest.toLocaleString()}</div>
                  </div>
                  <div>
                    <label>Capital Adj.</label>
                    <div>LKR {data.capital.toLocaleString()}</div>
                  </div>
                  <div>
                    <label>Net Cash Delta</label>
                    <div>
                      LKR {(data.newInvest - data.maturity).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {successMessage && (
        <section>
          <h2>Update</h2>
          <p>{successMessage}</p>
        </section>
      )}
    </main>
  );
}
