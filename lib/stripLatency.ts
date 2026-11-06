import { useLayoutEffect, useMemo } from 'react';
import { perfBisectActive } from './perfBisect';
import { getProductImages, type Product } from '../types/product';

/**
 * Diagnosis only, active only with EXPO_PUBLIC_PERF_BISECT defined (see perfBisect.ts); otherwise
 * `stripLatency` is null and every hook/handler below is a no-op that adds nothing to the tree.
 * Per swipe and deck role (current/next/+2): swipe → rendered strip 'ready', 'ready' → every cover
 * image onLoad, and the card's ranking.prepare queue wait and duration. Values: ms, "-" not applicable,
 * "pre" preparation started before the swipe, ">N" still waiting after N ms when superseded, "err" failed.
 * Logs carry numbers and role names only.
 */
export type StripStatus = 'loading' | 'ready' | 'error';
const ROLES = ['current', 'next', '+2'] as const;
type Role = typeof ROLES[number];

interface StripState { status: StripStatus; readySince?: number; uris: readonly string[]; loaded: Map<string, number>; failed: Set<string> }
interface Preparation { start: number; end?: number; cpu: number; slices: number; maxSlice: number; yieldWait: number; turnWait: number }
interface CardRecord { id: string; role: Role; start: number; cold: boolean; done: boolean }
type Value = number | '-' | 'pre' | 'err' | `>${number}`;
interface Sample { swipeToReady: Value; readyToImages: Value; queueWait: Value; prepare: Value }

interface StripLatencyDeps {
  now: () => number;
  log: (line: string) => void;
  summaryEvery?: number;
}

export function createStripLatencyTracker({ now, log, summaryEvery = 10 }: StripLatencyDeps) {
  const strips = new Map<string, StripState>();
  const preps = new Map<string, Preparation>();
  let records: CardRecord[] = [];
  let roundCold = false;
  let swipeAt: number | null = null;
  let swiped = false;
  let rounds = 0;
  let samples = new Map<Role, Sample[]>();
  let prepared: Preparation[] = [];

  const ms = (value: number): number => Math.round(Math.max(0, value));
  const waiting = (value: number): Value => `>${ms(value)}`;

  // Settled state of a card at `at`; `final` closes it even when something is still loading.
  const measure = (record: CardRecord, at: number, final: boolean): Sample | null => {
    const strip = strips.get(record.id);
    const prep = preps.get(record.id);
    const queueWait: Value = !prep ? '-' : prep.start < record.start ? 'pre' : ms(prep.start - record.start);
    const prepare: Value = !prep ? '-' : prep.end !== undefined ? ms(prep.end - prep.start) : waiting(at - prep.start);
    if (strip?.status === 'error') return { swipeToReady: 'err', readyToImages: '-', queueWait, prepare };
    if (strip?.status !== 'ready' || strip.readySince === undefined) {
      return final ? { swipeToReady: waiting(at - record.start), readyToImages: '-', queueWait, prepare } : null;
    }
    const readyAt = Math.max(record.start, strip.readySince);
    const swipeToReady = ms(readyAt - record.start);
    if (strip.uris.length === 0) return { swipeToReady, readyToImages: '-', queueWait, prepare };
    if (strip.uris.some(uri => strip.failed.has(uri))) return { swipeToReady, readyToImages: 'err', queueWait, prepare };
    if (strip.uris.every(uri => strip.loaded.has(uri))) {
      const loadedAt = Math.max(...strip.uris.map(uri => strip.loaded.get(uri)!));
      return { swipeToReady, readyToImages: ms(Math.max(readyAt, loadedAt) - readyAt), queueWait, prepare };
    }
    return final ? { swipeToReady, readyToImages: waiting(at - readyAt), queueWait, prepare } : null;
  };

  const emit = (record: CardRecord, sample: Sample) => {
    record.done = true;
    log(`[BISECT] strip role=${record.role} swipe_to_ready_ms=${sample.swipeToReady} ready_to_images_ms=${sample.readyToImages}`
      + ` queue_wait_ms=${sample.queueWait} prepare_ms=${sample.prepare} cold=${record.cold}`);
    if (!record.cold) samples.set(record.role, [...(samples.get(record.role) ?? []), sample]);
  };

  const evaluate = (id: string) => {
    const at = now();
    for (const record of records) {
      if (record.done || record.id !== id) continue;
      const sample = measure(record, at, false);
      if (sample) emit(record, sample);
    }
  };

  const percentiles = (values: Value[]): string => {
    const numbers = values.filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
    if (numbers.length === 0) return '-';
    const rank = (p: number) => numbers[Math.max(0, Math.ceil(p * numbers.length) - 1)];
    return `p50:${rank(0.5)}/p90:${rank(0.9)}`;
  };

  const summarize = () => {
    for (const role of ROLES) {
      const list = samples.get(role);
      if (!list || list.length === 0) continue;
      const incomplete = list.filter(sample => Object.values(sample).some(value => typeof value === 'string' && value.startsWith('>'))).length;
      log(`[BISECT] strip_summary swipes=${rounds} role=${role} n=${list.length}`
        + ` swipe_to_ready_ms=${percentiles(list.map(sample => sample.swipeToReady))}`
        + ` ready_to_images_ms=${percentiles(list.map(sample => sample.readyToImages))}`
        + ` queue_wait_ms=${percentiles(list.map(sample => sample.queueWait))}`
        + ` prepare_ms=${percentiles(list.map(sample => sample.prepare))} incomplete=${incomplete}`);
    }
    rounds = 0;
    samples = new Map();
  };

  const closeRound = (at: number) => {
    if (records.length === 0) return;
    for (const record of records) if (!record.done) emit(record, measure(record, at, true)!);
    records = [];
    if (roundCold) return;
    rounds += 1;
    if (rounds >= summaryEvery) summarize();
  };

  return {
    /** The swipe gesture committed: closes the shown round; the next deck change is timed from here. */
    swipe(): void {
      const at = now();
      closeRound(at);
      swipeAt = at;
      swiped = true;
    },
    /** The deck's first three products after a commit; a new current card opens a new round. */
    deck(ids: readonly string[]): void {
      const deckIds = ids.slice(0, ROLES.length);
      const at = now();
      if (records.length > 0 && records[0].id === deckIds[0]) {
        // Same current card: only a later slot changed (e.g. the feed appended), time that card from now.
        deckIds.forEach((id, index) => {
          const role = ROLES[index];
          const existing = records.find(record => record.role === role);
          if (existing?.id === id) return;
          if (existing && !existing.done) emit(existing, measure(existing, at, true)!);
          records = records.filter(record => record !== existing);
          records.push({ id, role, start: at, cold: roundCold, done: false });
          evaluate(id);
        });
        return;
      }
      closeRound(at);
      if (deckIds.length === 0) return;
      const start = swipeAt ?? at;
      swipeAt = null;
      roundCold = !swiped;
      records = deckIds.map((id, index) => ({ id, role: ROLES[index], start, cold: roundCold, done: false }));
      for (const id of [...strips.keys()]) if (!deckIds.includes(id)) strips.delete(id);
      for (const id of [...preps.keys()]) if (!deckIds.includes(id)) preps.delete(id);
      deckIds.forEach(evaluate);
    },
    /** The rendered strip's status and its cover image URIs (layout effect, i.e. at commit). */
    strip(id: string, status: StripStatus, uris: readonly string[]): void {
      const previous = strips.get(id);
      strips.set(id, { status, uris, loaded: previous?.loaded ?? new Map(), failed: previous?.failed ?? new Set(),
        readySince: status !== 'ready' ? undefined : previous?.status === 'ready' ? previous.readySince : now() });
      evaluate(id);
    },
    imageLoaded(id: string, uri: string): void {
      const strip = strips.get(id);
      if (!strip || strip.loaded.has(uri)) return;
      strip.loaded.set(uri, now());
      strip.failed.delete(uri);
      evaluate(id);
    },
    imageFailed(id: string, uri: string): void {
      const strip = strips.get(id);
      if (!strip) return;
      strip.failed.add(uri);
      evaluate(id);
    },
    /** ranking.prepare began for the anchor; a retry after an abort keeps the first start. */
    prepareStart(id: string): void {
      const previous = preps.get(id);
      if (!previous || previous.end !== undefined) preps.set(id, { start: now(), cpu: 0, slices: 0, maxSlice: 0, yieldWait: 0, turnWait: 0 });
    },
    /** Receives one preparation's slice, host yield and turn wait durations (see runCooperatively). */
    prepareProbe(id: string): (kind: 'slice' | 'yield' | 'turn', duration: number) => void {
      return (kind, duration) => {
        const prep = preps.get(id);
        if (!prep) return;
        if (kind === 'yield') prep.yieldWait += duration;
        else if (kind === 'turn') prep.turnWait += duration;
        else { prep.cpu += duration; prep.slices += 1; prep.maxSlice = Math.max(prep.maxSlice, duration); }
      };
    },
    prepareEnd(id: string): void {
      const prep = preps.get(id);
      if (!prep || prep.end !== undefined) return;
      prep.end = now();
      const role = records.find(record => record.id === id)?.role ?? 'none';
      log(`[BISECT] prepare role=${role} prepare_ms=${ms(prep.end - prep.start)} prepare_cpu_ms=${ms(prep.cpu)} slice_count=${prep.slices}`
        + ` max_slice_ms=${ms(prep.maxSlice)} yield_wait_ms=${ms(prep.yieldWait)} turn_wait_ms=${ms(prep.turnWait)}`);
      prepared.push(prep);
      if (prepared.length < summaryEvery) return;
      log(`[BISECT] prepare_summary n=${prepared.length} prepare_ms=${percentiles(prepared.map(entry => ms(entry.end! - entry.start)))}`
        + ` prepare_cpu_ms=${percentiles(prepared.map(entry => ms(entry.cpu)))} slice_count=${percentiles(prepared.map(entry => entry.slices))}`
        + ` yield_wait_ms=${percentiles(prepared.map(entry => ms(entry.yieldWait)))} turn_wait_ms=${percentiles(prepared.map(entry => ms(entry.turnWait)))}`);
      prepared = [];
    },
  };
}

export type StripLatencyTracker = ReturnType<typeof createStripLatencyTracker>;

export const stripLatency: StripLatencyTracker | null = perfBisectActive ? createStripLatencyTracker({
  now: () => performance.now(),
  // eslint-disable-next-line no-console
  log: line => console.log(line) }) : null;

function useStripLatencyReport(productId: string | null, status: StripStatus, products: readonly Product[]): void {
  const uris = useMemo(() => products.flatMap(product => {
    const uri = getProductImages(product)[0];
    return uri ? [uri] : [];
  }).join('\n'), [products]);
  useLayoutEffect(() => {
    if (productId) stripLatency?.strip(productId, status, uris ? uris.split('\n') : []);
  }, [productId, status, uris]);
}
function useStripLatencyNoop(): void {}

/** Reports the rendered strip of `productId`; a no-op hook without the variable. */
export const useStripLatency: (productId: string | null, status: StripStatus, products: readonly Product[]) => void =
  stripLatency ? useStripLatencyReport : useStripLatencyNoop;

const NO_HANDLERS = {};
/** onLoad/onError for one strip cover image; adds no props without the variable. */
export const stripImageHandlers = (productId: string | null, uri: string): { onLoad?: () => void; onError?: () => void } => {
  const tracker = stripLatency;
  if (!tracker || !productId) return NO_HANDLERS;
  return { onLoad: () => tracker.imageLoaded(productId, uri), onError: () => tracker.imageFailed(productId, uri) };
};
