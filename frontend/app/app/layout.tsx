import type { Metadata } from "next";
import AppShell from "./AppShell";

export const metadata: Metadata = {
  title: "Console",
  description: "Manage your Obscyro API keys, usage, and account.",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
