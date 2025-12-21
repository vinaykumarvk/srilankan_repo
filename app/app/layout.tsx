import "./globals.css";
import type { Metadata } from "next";
import AppShell from "./components/AppShell";

export const metadata: Metadata = {
  title: "Sri Lanka Repo Ops",
  description: "Repo placement and allocations workspace"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
