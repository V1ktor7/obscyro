"use client";

import TestPhaseNotice from "@/components/site/TestPhaseNotice";

export default function BetaBanner() {
  return (
    <div className="w-full border-b border-amber-500/30 bg-amber-500/10">
      <div className="container max-w-[1400px] py-1.5 sm:py-2">
        <TestPhaseNotice variant="banner" />
      </div>
    </div>
  );
}
