import { Suspense } from "react";

import SituationView from "./SituationView";

export default function SituationPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <SituationView />
    </Suspense>
  );
}
