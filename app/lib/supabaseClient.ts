import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Create a placeholder client during build time when env vars are not available
// This prevents build errors during static generation
const createSupabaseClient = (): SupabaseClient => {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a mock client during build time
    // This will be replaced with real client at runtime
    if (typeof window === "undefined") {
      // Server-side during build - return placeholder
      return createClient(
        "https://placeholder.supabase.co",
        "placeholder-key"
      );
    }
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();
