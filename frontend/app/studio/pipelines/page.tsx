import { Suspense } from "react";

import PipelinesView from "./PipelinesView";

export default function PipelinesPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <PipelinesView />
    </Suspense>
  );
}
