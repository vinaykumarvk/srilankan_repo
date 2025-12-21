/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable standalone output for Docker deployment
  output: "standalone",
  // Disable image optimization for simpler deployment (or configure external loader)
  images: {
    unoptimized: true,
  },
  // Environment variables that should be available at build time
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  // Disable static exports - all pages will be server-rendered
  // This is needed because pages require runtime environment variables
  experimental: {
    // Workaround for build-time env var issues
  },
};

export default nextConfig;
