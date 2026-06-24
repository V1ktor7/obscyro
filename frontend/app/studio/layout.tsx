import type { Metadata } from "next";

import StudioShell from "./StudioShell";

export const metadata: Metadata = {
  title: "Studio",
  description: "Parse, model, and build on your Obscyro ontology.",
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
