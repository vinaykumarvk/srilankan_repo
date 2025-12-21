import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Log configuration status (will appear in browser console)
if (typeof window !== "undefined") {
  console.log("[Supabase] URL configured:", !!supabaseUrl);
  console.log("[Supabase] Key configured:", !!supabaseAnonKey);
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[Supabase] ERROR: Missing environment variables!");
    console.error("NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? "SET" : "MISSING");
    console.error("NEXT_PUBLIC_SUPABASE_ANON_KEY:", supabaseAnonKey ? "SET" : "MISSING");
  }
}

// Create Supabase client
// Note: NEXT_PUBLIC_ vars are embedded at build time, so they must be
// passed as build args when building the Docker image
const createSupabaseClient = (): SupabaseClient => {
  // During SSR/build without env vars, use placeholder to prevent crashes
  if (!supabaseUrl || !supabaseAnonKey) {
    if (typeof window === "undefined") {
      return createClient(
        "https://placeholder.supabase.co",
        "placeholder-key"
      );
    }
    // Client-side with missing vars - still create client but it will fail on requests
    // The console.error above will help debug
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();

// Export config check function for debugging
export const isSupabaseConfigured = () => !!supabaseUrl && !!supabaseAnonKey;
