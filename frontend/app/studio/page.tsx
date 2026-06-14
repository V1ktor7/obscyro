"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getSession } from "@/lib/auth";
import StudioEditor from "./StudioEditor";

export default function StudioPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/sign-in");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
      </div>
    );
  }

  return <StudioEditor />;
}
