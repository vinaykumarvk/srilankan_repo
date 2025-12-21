"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import NavMenu from "./NavMenu";
import Auth from "./Auth";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

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

    return () => subscription.unsubscribe();
  }, []);

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
    <div className="app-layout">
      <NavMenu />
      <div className="main-content">
        {children}
      </div>
    </div>
  );
}

