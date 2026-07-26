import { Suspense } from "react";

import DataView from "./DataView";

export default function DataPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <DataView />
    </Suspense>
  );
}
