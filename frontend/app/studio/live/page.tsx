"use client";

import { Suspense } from "react";

import LiveTwinView from "./LiveTwinView";

/**
 * Units: the tree of the twin's units, live.
 *
 * Inside a Suspense boundary because the view reads the address: an alert or a
 * signal links here with `?unit=`, and that unit's detail opens on arrival.
 */
export default function LivePage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <LiveTwinView />
    </Suspense>
  );
}
