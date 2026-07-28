import { Suspense } from "react";

import SourcesView from "./SourcesView";

export default function SourcesPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <SourcesView />
    </Suspense>
  );
}
