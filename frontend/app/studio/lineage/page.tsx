import { Suspense } from "react";

import LineageView from "./LineageView";

export default function LineagePage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <LineageView />
    </Suspense>
  );
}
