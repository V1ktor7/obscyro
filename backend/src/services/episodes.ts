/**
 * Does the lead hold up on every wave, or did it hold up once?
 *
 * A long series is not the same as many observations. Three years of daily
 * hospital counts is one smooth curve with a handful of independent points in
 * it, and correlating it end to end gives a bigger number without giving more
 * evidence.
 *
 * What actually settles the question is replication. If wastewater leads
 * admissions by five days, it should lead by roughly five days in the wave of
 * April 2020, again in January 2021, again in January 2022 — each of those a
 * separate outbreak with its own variant, its own season and its own testing
 * regime. A lead that survives ten of those is a finding. One that appears in
 * three and disagrees with itself is the search finding what it was looking
 * for.
 *
 * So this file cuts a long series into episodes and asks the same question of
 * each, and the answer it reports is the agreement between them rather than the
 * strength of any one.
 */

import { findLead, type Lead } from "./lag-scan.js";

export interface Episode {
  /** First step of the window. */
  start: number;
  /** Where the target peaked. */
  peak: number;
  /** Last step of the window, inclusive. */
  end: number;
  height: number;
}

export interface EpisodeOptions {
  /**
   * Steps two peaks must be apart to count as separate episodes.
   *
   * The shoulder of one wave is not a second wave. Too small and a bumpy
   * descent becomes four outbreaks; too large and two real waves are merged
   * into one and their disagreement is hidden.
   */
  minSeparation: number;
  /** Steps either side of the peak to include. */
  halfWidth: number;
  /**
   * How tall a peak must be, as a fraction of the tallest in the series.
   *
   * Relative rather than absolute so the same call works on admissions, on
   * deaths and on a viral load, whose units share nothing. A ripple at two
   * percent of the largest wave is noise in any of them.
   */
  minHeightFraction?: number;
  /** Steps averaged either side when smoothing before the search. */
  smoothing?: number;
}

/** A centred moving average, so a peak is not found on a single noisy day. */
function smoothed(series: ReadonlyArray<number | null>, half: number): Array<number | null> {
  if (half <= 0) return series.slice();
  return series.map((_, i) => {
    const win: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(series.length - 1, i + half); j++) {
      const v = series[j];
      if (v !== null && v !== undefined) win.push(v);
    }
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

export function findEpisodes(
  target: ReadonlyArray<number | null>,
  opts: EpisodeOptions,
): Episode[] {
  const sm = smoothed(target, opts.smoothing ?? 3);
  const highest = sm.reduce<number>((m, v) => (v !== null && v > m ? v : m), 0);
  if (highest <= 0) return [];
  const floor = highest * (opts.minHeightFraction ?? 0.1);
  const reach = Math.max(1, Math.floor(opts.minSeparation / 2));

  const peaks: Episode[] = [];
  for (let i = 0; i < sm.length; i++) {
    const v = sm[i];
    if (v === null || v === undefined || v < floor) continue;
    let tallest = true;
    for (let j = Math.max(0, i - reach); j <= Math.min(sm.length - 1, i + reach); j++) {
      const w = sm[j];
      if (w !== null && w !== undefined && w > v) {
        tallest = false;
        break;
      }
    }
    if (!tallest) continue;
    const prior = peaks[peaks.length - 1];
    // Two candidates inside one separation are one wave seen twice. The taller
    // wins, so a flat-topped peak does not become two episodes.
    if (prior && i - prior.peak < opts.minSeparation) {
      if (v > prior.height) peaks[peaks.length - 1] = { ...prior, peak: i, height: v };
      continue;
    }
    peaks.push({ start: 0, peak: i, end: 0, height: v });
  }

  return peaks.map((p) => ({
    ...p,
    start: Math.max(0, p.peak - opts.halfWidth),
    end: Math.min(target.length - 1, p.peak + opts.halfWidth),
  }));
}

export interface EpisodeLead {
  episode: Episode;
  /** Null when the window held too little to say anything. */
  lead: Lead | null;
}

export interface Replication {
  perEpisode: EpisodeLead[];
  /** Episodes that produced a lag at all. */
  measured: number;
  /** The lags found, in episode order. */
  lags: number[];
  medianLag: number | null;
  /**
   * Episodes whose lag sits within `tolerance` of the median, over those
   * measured.
   *
   * This is the number the whole file exists to produce. A strong correlation
   * in one episode says nothing that a strong correlation in noise would not
   * also say; ten episodes agreeing on a lag is a different kind of claim.
   */
  agreement: number;
  /**
   * True only when enough episodes were measured and most of them agree.
   *
   * Deliberately conservative. The cost of missing a real lead is that somebody
   * looks again next wave; the cost of announcing one that is not there is that
   * a hospital plans around it.
   */
  replicates: boolean;
}

export function replicationAcross(
  signal: ReadonlyArray<number | null>,
  target: ReadonlyArray<number | null>,
  episodes: readonly Episode[],
  opts: { maxLag: number; tolerance?: number; minEpisodes?: number; testsRun?: number },
): Replication {
  const tolerance = opts.tolerance ?? 2;
  const minEpisodes = opts.minEpisodes ?? 4;

  const perEpisode: EpisodeLead[] = episodes.map((episode) => ({
    episode,
    // No holdout inside an episode: the episodes *are* the holdout for each
    // other, and carving a fifth off an already short window would leave too
    // little on either side to measure.
    lead: findLead(
      signal.slice(episode.start, episode.end + 1),
      target.slice(episode.start, episode.end + 1),
      { maxLag: opts.maxLag, testsRun: opts.testsRun, holdoutFraction: 0 },
    ),
  }));

  const lags = perEpisode
    .map((e) => e.lead?.lag)
    .filter((l): l is number => l !== undefined && l !== null);
  const sorted = lags.slice().sort((a, b) => a - b);
  const medianLag =
    sorted.length === 0
      ? null
      : sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]!
        : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;

  const near = medianLag === null ? 0 : lags.filter((l) => Math.abs(l - medianLag) <= tolerance).length;
  const agreement = lags.length === 0 ? 0 : near / lags.length;

  return {
    perEpisode,
    measured: lags.length,
    lags,
    medianLag,
    agreement,
    replicates: lags.length >= minEpisodes && agreement >= 0.7,
  };
}
