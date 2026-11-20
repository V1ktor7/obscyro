"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";

// The /studio editor is a full-screen app surface, so we drop the marketing
// chrome (header, footer) on those routes. The colours are the same on both
// sides: one theme, set on the root (globals.css).
export default function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = pathname?.startsWith("/studio") ?? false;
  if (bare) {
    return <main className="min-h-screen">{children}</main>;
  }

  // The public pages carry their own scale of type (`.site` in globals.css);
  // /studio keeps its denser one. Scoping it here rather than per page means
  // the header and footer are in the same world as whatever sits between them.
  return (
    <div className="site">
      <Header />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer />
    </div>
  );
}
