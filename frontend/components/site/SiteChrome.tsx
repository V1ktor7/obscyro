"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import BetaBanner from "@/components/site/BetaBanner";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";

// The /studio editor is a full-screen app surface, so we drop the marketing
// chrome (beta banner, header, footer) on those routes.
export default function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = pathname?.startsWith("/studio") ?? false;
  // The marketing surface carries its own type and colour system; /studio keeps
  // the product's. Scoping it here rather than per page means the banner,
  // header and footer are in the same world as whatever sits between them.
  const light = !bare;

  if (bare) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className={light ? "site-light" : undefined}>
      <BetaBanner />
      <Header />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer />
    </div>
  );
}
