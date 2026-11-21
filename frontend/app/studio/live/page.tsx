"use client";

import { Suspense } from "react";

import UnitsView from "./UnitsView";

/**
 * Units: every unit of the twin, live, ranked on one measure.
 *
 * Inside a Suspense boundary because the view reads the address: an alert or a
 * signal links here with `?unit=`, and that unit is selected on arrival.
 */
export default function LivePage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <UnitsView />
    </Suspense>
  );
}
