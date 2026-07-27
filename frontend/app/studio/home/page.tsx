import { Suspense } from "react";

import HomeView from "./HomeView";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <HomeView />
    </Suspense>
  );
}
