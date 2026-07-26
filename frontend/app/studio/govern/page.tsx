import { Suspense } from "react";

import GovernView from "./GovernView";

export default function GovernPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <GovernView />
    </Suspense>
  );
}
