import type { Metadata } from "next";
import { type ReactNode } from "react";
import MobileNav from "@/components/docs/MobileNav";
import Sidebar from "@/components/docs/Sidebar";

// The documentation is linked from the header: it opens on the product's own
// pages, then the API reference. It is still kept out of search results, which
// is a separate decision from showing it to someone who is already on the site.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border-subtle">
      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-r border-border-subtle px-6 lg:block">
          <Sidebar />
        </aside>
        <div className="min-w-0">
          <MobileNav />
          {children}
        </div>
      </div>
    </div>
  );
}
