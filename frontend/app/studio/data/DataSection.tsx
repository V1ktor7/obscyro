"use client";

/**
 * The two pages of the Data workspace, told apart by `?view=`: the project's
 * datasets, and the series the platform keeps from them and from the twin.
 */

import { useSearchParams } from "next/navigation";

import DataView from "./DataView";
import KeptSeriesView from "./KeptSeries";

export default function DataSection() {
  const view = useSearchParams()?.get("view");
  return view === "series" ? <KeptSeriesView /> : <DataView />;
}
