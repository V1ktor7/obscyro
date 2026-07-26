import { Suspense } from "react";

import AdminView from "./AdminView";

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <AdminView />
    </Suspense>
  );
}
