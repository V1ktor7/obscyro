import { type ReactNode } from "react";
import MobileNav from "@/components/docs/MobileNav";
import Sidebar from "@/components/docs/Sidebar";

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
