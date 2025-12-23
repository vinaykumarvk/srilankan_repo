"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrgOption = { id: string; name: string };
type Portfolio = { id: string; name: string; code: string };
type PortfolioGroup = {
  id: string;
  name: string;
  created_at: string;
  member_count?: number;
};
type GroupMember = {
  id: string;
  portfolio_id: string;
  portfolios: { name: string; code: string } | null;
};

export default function PortfolioGroupsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>("");

  const [groups, setGroups] = useState<PortfolioGroup[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);

  // New group form
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Add member form
  const [addingMember, setAddingMember] = useState(false);
  const [selectedPortfolioToAdd, setSelectedPortfolioToAdd] = useState("");

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError("Please sign in to manage portfolio groups.");
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

    const loadData = async () => {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);

      const [groupsRes, portfoliosRes] = await Promise.all([
        supabase
          .from("portfolio_groups")
          .select("id, name, created_at")
          .eq("org_id", orgId)
          .order("name", { ascending: true }),
        supabase
          .from("portfolios")
          .select("id, name, code")
          .eq("org_id", orgId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      ]);

      if (groupsRes.error || portfoliosRes.error) {
        setError(groupsRes.error?.message || portfoliosRes.error?.message || "Failed to load data.");
        setLoading(false);
        return;
      }

      // Get member counts for each group
      const groupsWithCounts = await Promise.all(
        (groupsRes.data ?? []).map(async (group) => {
          const { count } = await supabase
            .from("portfolio_group_members")
            .select("id", { count: "exact", head: true })
            .eq("group_id", group.id);
          return { ...group, member_count: count ?? 0 };
        })
      );

      setGroups(groupsWithCounts);
      setPortfolios(portfoliosRes.data ?? []);
      setLoading(false);
    };

    loadData();
  }, [orgId]);

  useEffect(() => {
    if (!selectedGroupId) {
      setGroupMembers([]);
      return;
    }

    const loadMembers = async () => {
      const { data, error: membersError } = await supabase
        .from("portfolio_group_members")
        .select("id, portfolio_id, portfolios ( name, code )")
        .eq("group_id", selectedGroupId)
        .order("created_at", { ascending: true });

      if (membersError) {
        setError(membersError.message);
        return;
      }

      setGroupMembers((data as unknown as GroupMember[]) ?? []);
    };

    loadMembers();
  }, [selectedGroupId]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      setError("Group name is required.");
      return;
    }

    setCreatingGroup(true);
    setError(null);

    const { data, error: createError } = await supabase
      .from("portfolio_groups")
      .insert({
        org_id: orgId,
        name: newGroupName.trim()
      })
      .select("id, name, created_at")
      .single();

    if (createError) {
      setError(createError.message);
      setCreatingGroup(false);
      return;
    }

    setGroups((prev) => [...prev, { ...data, member_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setNewGroupName("");
    setShowNewGroupForm(false);
    setSuccessMessage(`Group "${data.name}" created successfully.`);
    setSelectedGroupId(data.id);
    setCreatingGroup(false);
  };

  const handleDeleteGroup = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    if (!confirm(`Are you sure you want to delete "${group.name}"? This will remove all portfolio memberships.`)) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("portfolio_groups")
      .delete()
      .eq("id", groupId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    if (selectedGroupId === groupId) {
      setSelectedGroupId("");
      setGroupMembers([]);
    }
    setSuccessMessage(`Group "${group.name}" deleted.`);
  };

  const handleAddMember = async () => {
    if (!selectedGroupId || !selectedPortfolioToAdd) return;

    setAddingMember(true);
    setError(null);

    const { error: addError } = await supabase
      .from("portfolio_group_members")
      .insert({
        org_id: orgId,
        group_id: selectedGroupId,
        portfolio_id: selectedPortfolioToAdd
      });

    if (addError) {
      if (addError.message.includes("duplicate")) {
        setError("This portfolio is already in the group.");
      } else {
        setError(addError.message);
      }
      setAddingMember(false);
      return;
    }

    // Reload members
    const { data } = await supabase
      .from("portfolio_group_members")
      .select("id, portfolio_id, portfolios ( name, code )")
      .eq("group_id", selectedGroupId)
      .order("created_at", { ascending: true });

    setGroupMembers((data as unknown as GroupMember[]) ?? []);

    // Update count
    setGroups((prev) =>
      prev.map((g) =>
        g.id === selectedGroupId ? { ...g, member_count: (g.member_count ?? 0) + 1 } : g
      )
    );

    setSelectedPortfolioToAdd("");
    setSuccessMessage("Portfolio added to group.");
    setAddingMember(false);
  };

  const handleRemoveMember = async (memberId: string, portfolioName: string) => {
    if (!confirm(`Remove "${portfolioName}" from this group?`)) return;

    const { error: removeError } = await supabase
      .from("portfolio_group_members")
      .delete()
      .eq("id", memberId);

    if (removeError) {
      setError(removeError.message);
      return;
    }

    setGroupMembers((prev) => prev.filter((m) => m.id !== memberId));

    // Update count
    setGroups((prev) =>
      prev.map((g) =>
        g.id === selectedGroupId ? { ...g, member_count: Math.max((g.member_count ?? 1) - 1, 0) } : g
      )
    );

    setSuccessMessage(`"${portfolioName}" removed from group.`);
  };

  // Portfolios not already in the selected group
  const availablePortfolios = portfolios.filter(
    (p) => !groupMembers.some((m) => m.portfolio_id === p.id)
  );

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
  if (error === "Please sign in to manage portfolio groups.") {
    return null;
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <div className="badge">Settings</div>
          <h1>Portfolio Groups</h1>
          <p>Create and manage portfolio groups for mass rollover operations.</p>
        </div>
        <button
          className="primary"
          onClick={() => setShowNewGroupForm(true)}
          disabled={showNewGroupForm}
        >
          + New Group
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

      {showNewGroupForm && (
        <section className="form-card">
          <h3>Create New Group</h3>
          <div className="section-grid">
            <div>
              <label>Group Name</label>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g., Growth Funds, Fixed Income"
              />
            </div>
          </div>
          <div className="actions" style={{ marginTop: "16px" }}>
            <button
              className="primary"
              onClick={handleCreateGroup}
              disabled={creatingGroup || !newGroupName.trim()}
            >
              {creatingGroup ? "Creating..." : "Create Group"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setShowNewGroupForm(false);
                setNewGroupName("");
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "24px", marginTop: "24px" }}>
        {/* Groups List */}
        <section>
          <h2>Groups ({groups.length})</h2>
          {groups.length === 0 ? (
            <p className="footer-note">No portfolio groups created yet.</p>
          ) : (
            <div className="allocations">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className={`allocation-row ${selectedGroupId === group.id ? "selected" : ""}`}
                  style={{
                    cursor: "pointer",
                    borderColor: selectedGroupId === group.id ? "var(--reef)" : undefined
                  }}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong>{group.name}</strong>
                      <p className="footer-note" style={{ margin: 0 }}>
                        {group.member_count} portfolio{group.member_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <button
                      className="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(group.id);
                      }}
                      style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Group Members */}
        <section>
          {selectedGroupId ? (
            <>
              <h2>
                Members of "{groups.find((g) => g.id === selectedGroupId)?.name}"
              </h2>

              {/* Add member form */}
              <div className="form-card" style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label>Add Portfolio</label>
                    <select
                      value={selectedPortfolioToAdd}
                      onChange={(e) => setSelectedPortfolioToAdd(e.target.value)}
                    >
                      <option value="">Select portfolio to add...</option>
                      {availablePortfolios.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="primary"
                    onClick={handleAddMember}
                    disabled={!selectedPortfolioToAdd || addingMember}
                    style={{ marginBottom: "6px" }}
                  >
                    {addingMember ? "Adding..." : "Add"}
                  </button>
                </div>
                {availablePortfolios.length === 0 && (
                  <p className="footer-note" style={{ marginTop: "8px" }}>
                    All portfolios are already in this group.
                  </p>
                )}
              </div>

              {/* Members list */}
              {groupMembers.length === 0 ? (
                <div className="allocation-row">
                  <p>No portfolios in this group yet. Add some above.</p>
                </div>
              ) : (
                <div className="allocations">
                  {groupMembers.map((member) => (
                    <div key={member.id} className="allocation-row">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <strong>{member.portfolios?.name ?? "Portfolio"}</strong>
                          <span style={{ marginLeft: "8px", color: "var(--muted)", fontSize: "0.85rem" }}>
                            {member.portfolios?.code}
                          </span>
                        </div>
                        <button
                          className="ghost"
                          onClick={() => handleRemoveMember(member.id, member.portfolios?.name ?? "Portfolio")}
                          style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
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
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <p>Select a group to manage its portfolios</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}


