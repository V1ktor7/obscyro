"use client";

/**
 * Twin → Profiles: the catalogue on its own page. A profile picked here starts
 * a new event on the Events page, built on the twin that is open.
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { fetchSimExport, type SimExport } from "@/lib/platform-api";
import ProfileCatalogue from "../events/builder/ProfileCatalogue";
import { builderTwin } from "../events/builder/twin";
import { useStudio } from "../StudioShell";

export default function ProfilesView() {
  const { selectedEnv: env } = useStudio();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SimExport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!env) return;
    let cancelled = false;
    setError(null);
    fetchSimExport(env)
      .then((s) => { if (!cancelled) setSnapshot(s); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [env]);

  const tw = useMemo(() => (snapshot ? builderTwin(snapshot) : null), [snapshot]);

  if (error) return <p className="m-6 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>;
  if (!env || !tw) return <p className="px-6 py-6 text-xs text-ink-faint">Reading your twin…</p>;
  return (
    <ProfileCatalogue
      env={env}
      tw={tw}
      ctx={{ horizon: 60, unit: "day" }}
      mode="page"
      onStartNew={(p) => router.push(`/studio/events?profile=${encodeURIComponent(p.id)}`)}
    />
  );
}
