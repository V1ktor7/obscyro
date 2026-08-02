import { Suspense } from "react";

import ResponseView from "./ResponseView";

export default function ResponsePage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <ResponseView />
    </Suspense>
  );
}
