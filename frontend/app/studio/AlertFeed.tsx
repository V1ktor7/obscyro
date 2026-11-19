"use client";

/**
 * The open alerts, read once for the whole studio.
 *
 * The shell mounts this around every page. It reads the project's alert feed
 * every few seconds and hands the same reading to whoever asks: the banner in
 * the shell, the twin pages, the response board. Before this each page had its
 * own clock — ten seconds, thirty seconds, a Refresh button — and an alert
 * reached a person only if they stood on the right page.
 *
 * It never guesses. When a reading fails the last one stays on screen, marked
 * as old once it is: an alert list that silently stops updating looks exactly
 * like a calm network.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { fetchAlertFeed, type AlertFeed } from "@/lib/platform-api";

import { EMPTY_FEED, POLL_MS, absorb, expire, feedStatus, type FeedState, type FeedStatus, type FirstSight } from "./alert-feed-state";

export interface AlertFeedValue {
  feed: AlertFeed | null;
  status: FeedStatus;
  /** Alerts that opened while this screen was watching, by id. */
  fresh: Record<string, FirstSight>;
  /** This computer's clock at the last reading that worked. */
  lastOkAtMs: number | null;
  /** Read again now: after an acknowledgement, a reading three seconds away is too far. */
  refresh: () => Promise<void>;
  /** Stop announcing an alert on this screen. The alert itself is untouched. */
  dismiss: (id: string) => void;
}

/** Outside the shell — a test, a page rendered alone — there is no feed, and that is said rather than faked. */
const OFF: AlertFeedValue = {
  feed: null,
  status: "off",
  fresh: {},
  lastOkAtMs: null,
  refresh: async () => {},
  dismiss: () => {},
};

/** Exported so a test can hand a page the reading it wants; pages use `useAlertFeed`. */
export const AlertFeedContext = createContext<AlertFeedValue>(OFF);

export function useAlertFeed(): AlertFeedValue {
  return useContext(AlertFeedContext);
}

export function AlertFeedProvider({ env, enabled, children }: { env: string | null; enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<FeedState>(EMPTY_FEED);
  const [now, setNow] = useState(() => Date.now());
  const on = enabled && Boolean(env);
  const reading = useRef(false);

  const read = useCallback(async () => {
    // One reading at a time: a slow answer must not be overtaken by the next.
    if (!on || !env || reading.current) return;
    reading.current = true;
    try {
      const feed = await fetchAlertFeed(env);
      setState((prev) => absorb(prev, feed, Date.now()));
    } catch {
      // The last reading stays; `status` turns stale when it has aged.
    } finally {
      reading.current = false;
      setNow(Date.now());
    }
  }, [env, on]);

  useEffect(() => {
    // Another project's alerts are not this one's: start from nothing.
    setState(EMPTY_FEED);
    if (!on) return;
    void read();
    const id = setInterval(() => {
      setState((prev) => expire(prev, Date.now()));
      void read();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [on, read]);

  const dismiss = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.fresh[id]) return prev;
      const fresh = { ...prev.fresh };
      delete fresh[id];
      return { ...prev, fresh };
    });
  }, []);

  const value = useMemo<AlertFeedValue>(
    () => ({
      feed: state.feed,
      status: feedStatus(state, now, on),
      fresh: state.fresh,
      lastOkAtMs: state.lastOkAtMs,
      refresh: read,
      dismiss,
    }),
    [state, now, on, read, dismiss],
  );

  return <AlertFeedContext.Provider value={value}>{children}</AlertFeedContext.Provider>;
}
