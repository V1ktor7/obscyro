import { Suspense } from "react";

import DataSection from "./DataSection";

export default function DataPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <DataSection />
    </Suspense>
  );
}
