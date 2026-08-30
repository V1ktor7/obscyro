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
  // The landing page is dark and the documentation is not. Scoping it here
  // rather than on the page means the banner, header and footer come with it,
  // so there is no white bar sitting above a black hero.
  const dark = pathname === "/";

  if (bare) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className={dark ? "landing-dark" : undefined}>
      <BetaBanner />
      <Header />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer />
    </div>
  );
}
