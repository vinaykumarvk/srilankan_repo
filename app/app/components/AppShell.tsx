"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import NavMenu from "./NavMenu";
import Auth from "./Auth";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    // Check initial auth state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsAuthenticated(!!session);
      }
    );

    // Load sidebar state from localStorage
    const savedCollapsed = localStorage.getItem("sidebarCollapsed");
    if (savedCollapsed !== null) {
      setSidebarCollapsed(savedCollapsed === "true");
    }

    return () => subscription.unsubscribe();
  }, []);

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem("sidebarCollapsed", String(newState));
  };

  // Still loading
  if (isAuthenticated === null) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  // Not authenticated - show login
  if (!isAuthenticated) {
    return <Auth />;
  }

  // Authenticated - show app with navigation
  return (
    <div className={`app-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <NavMenu collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="main-content">
        {children}
      </div>
    </div>
  );
}
