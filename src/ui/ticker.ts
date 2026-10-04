// The top ticker's model (playtest 3, the maintainer: "The black and white text pop-ups block the
// actual game"; interview round 1 [decided]: "Top ticker strip": one line at a time along the top
// edge, fading fast, the road kept clear, takedown names flashing briefly and small).
//
// Every in-race text pop-up is an item here: a rival's or cop's bark, a style chip, a takedown name,
// the live style meter. The strip shows ONE item at a time. Pure logic with an injected clock (ms),
// no DOM and no timers, so it is unit-tested (ticker.test.ts) and the view (ticker-view.ts) only
// draws what `step` returns. The numbers below are `[default]`; the two marked "slider" are tuning
// sliders (hud-tuning.ts).
//
// Priority (1 = top). A higher class preempts a lower one that is showing. A preempted teach, ask,
// bark or system item is frozen with its remaining time and comes back; a preempted line, style or
// meter item is stale and is dropped (the meter comes back once the strip is idle).
import { meterLabel, type MeterRun, type StylePop } from './race-feed';

export type TickerClass = 'teach' | 'name' | 'ask' | 'bark' | 'system' | 'line' | 'style' | 'meter';

/** The classes in priority order, top first. */
export const TICKER_CLASSES: readonly TickerClass[] = [
  'teach',
  'name',
  'ask',
  'bark',
  'system',
  'line',
  'style',
  'meter',
];

const PRIORITY: Readonly<Record<TickerClass, number>> = Object.fromEntries(
  TICKER_CLASSES.map((c, i) => [c, i + 1]),
) as Record<TickerClass, number>;

/** A class's priority, 1 (top) to 8. */
export const tickerPriority = (cls: TickerClass): number => PRIORITY[cls];

/** Most items waiting at once; past it the oldest of the lowest class goes. */
export const TICKER_QUEUE_MAX = 6;
/** How long each class waits in the queue before it is dropped as stale (ms). A resumed item never expires. */
export const TICKER_MAX_WAIT_MS: Readonly<Record<TickerClass, number>> = {
  teach: 8000,
  name: 600,
  ask: 8000,
  bark: 2500,
  system: 10_000,
  line: 500,
  style: 1500,
  meter: 0,
};
/** A takedown name's flash (ms): the slider's default. */
export const TICKER_NAME_MS = 900;
/** A landing one-liner's time (ms): the slider's default. */
export const TICKER_LINE_MS = 1600;
/** A style chip's time, a repeat restarting it (ms). */
export const TICKER_STYLE_MS = 1100;
/** A system line's time (ms). */
export const TICKER_SYSTEM_MS = 3000;
/** A released hold keeps the item up this much longer (ms), when its own time ran out while held. */
export const TICKER_RELEASE_GRACE_MS = 1000;
/** A voiced bark's subtitle outlasts its voice by this much (ms). */
export const TICKER_VOICE_TAIL_MS = 250;

/** The classes whose item is frozen and resumed when a higher class takes the strip. */
const RESUMES: ReadonlySet<TickerClass> = new Set(['teach', 'ask', 'bark', 'system']);

export interface TickerItem {
  cls: TickerClass;
  text: string;
  /** A speaker or source chip: 'DEACON VANE', 'PRODUCER', 'OFFICER METER'. */
  tag?: string;
  /** Style cash; summed when a repeat of the same `kind` merges. */
  cash?: number | null;
  /** The style merge key ('nearMiss', 'trick:BACKFLIP'). */
  kind?: string;
  /** Set when the item is vetoable ("cut this"). */
  contentRef?: string;
  raceId?: string;
  tick?: number;
  /** Overrides the class's time (a bark's `durationS`). */
  dwellMs?: number;
  /** A style item that is a run's landed award (the meter's chip, now paid out). */
  landed?: boolean;
}

/** An item on the strip now. */
export interface ShownTickerItem {
  readonly id: number;
  readonly cls: TickerClass;
  readonly text: string;
  readonly tag: string | undefined;
  readonly cash: number | null;
  /** How many repeats merged into it (1 for a lone item). */
  readonly count: number;
  readonly kind: string | undefined;
  readonly contentRef: string | undefined;
  readonly raceId: string | undefined;
  readonly tick: number | undefined;
  readonly landed: boolean;
  /** The live meter before its run has lasted long enough to pay. */
  readonly pending: boolean;
  /** The clock (ms) when it started and when it ends. */
  readonly startedAt: number;
  readonly endsAt: number;
  /** A finger rests on it ("cut this"). */
  readonly held: boolean;
}

export interface Ticker {
  /** Adds an item; a style repeat merges into the one showing or waiting. */
  push(item: TickerItem, nowMs: number): void;
  /** The player's style run in progress (null for none): shown only while the strip is idle. */
  meter(run: MeterRun | null, nowMs: number): void;
  /** Advances to `nowMs`: expires, resumes and starts items. `changed` is true when what shows differs from the last step. */
  step(nowMs: number): { item: Readonly<ShownTickerItem> | null; changed: boolean };
  /** A voice started for the item with this reference, ending at `voiceEndsMs`: the subtitle stays up until then (plus a tail). */
  extend(contentRef: string, voiceEndsMs: number): void;
  /** A finger rests on the showing item (or lifts): it stays up, and gets a grace after the lift. */
  hold(on: boolean, nowMs: number): void;
  /** "Cut this": the showing item and every waiting one with this reference go. */
  cut(contentRef: string): void;
  /** Drops the showing and waiting items of one class. */
  clearClass(cls: TickerClass): void;
  /** Style chips and the meter on or off (the `stylePopups` setting); off drops what is up. */
  setStyleEnabled(on: boolean): void;
  /** The item on the strip now, or null. */
  current(): Readonly<ShownTickerItem> | null;
  /** Everything gone: a new race starts clean. */
  clear(): void;
  /** Items waiting, in the order they will be picked (for tests). */
  waiting(): readonly Readonly<TickerItem>[];
}

export interface TickerOptions {
  /** Seconds-as-ms for the two sliders. */
  nameMs?: () => number;
  lineMs?: () => number;
  /** Called when an item starts for the first time (not when a preempted one resumes). */
  onShow?: (item: Readonly<ShownTickerItem>) => void;
}

type Mutable = { -readonly [K in keyof ShownTickerItem]: ShownTickerItem[K] };
interface Entry {
  id: number;
  item: TickerItem;
  count: number;
  cash: number | null;
  queuedAt: number;
  /** Set for a preempted item: the time it still has left. */
  remainingMs: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const chars = (text: string) => [...text].length;

export function createTicker(options: TickerOptions = {}): Ticker {
  let nextId = 1;
  let now = 0;
  let version = 0;
  let reported = 0;
  let cur: (Mutable & { expired: boolean; remainingMs: number | null }) | null = null;
  let queue: Entry[] = [];
  let run: MeterRun | null = null;
  let styleOn = true;

  const dwellOf = (item: TickerItem): number => {
    if (item.dwellMs !== undefined && Number.isFinite(item.dwellMs)) return Math.max(0, item.dwellMs);
    const n = chars(item.text);
    switch (item.cls) {
      case 'teach':
        return clamp((n / 14) * 1000, 3000, 5000);
      case 'name':
        return options.nameMs?.() ?? TICKER_NAME_MS;
      case 'ask':
        return clamp((n / 14) * 1000, 2500, 4500);
      case 'bark':
        return Math.max(2000, (n / 15) * 1000);
      case 'system':
        return TICKER_SYSTEM_MS;
      case 'line':
        return options.lineMs?.() ?? TICKER_LINE_MS;
      case 'style':
        return TICKER_STYLE_MS;
      case 'meter':
        return Infinity;
    }
  };

  const isStyle = (cls: TickerClass) => cls === 'style' || cls === 'meter';

  const begin = (e: Entry) => {
    const fresh = e.remainingMs === null;
    const ms = e.remainingMs ?? dwellOf(e.item);
    cur = {
      id: e.id,
      cls: e.item.cls,
      text: e.item.text,
      tag: e.item.tag,
      cash: e.cash,
      count: e.count,
      kind: e.item.kind,
      contentRef: e.item.contentRef,
      raceId: e.item.raceId,
      tick: e.item.tick,
      landed: e.item.landed === true,
      pending: false,
      startedAt: now,
      endsAt: now + ms,
      held: false,
      expired: false,
      remainingMs: null,
    };
    version++;
    if (fresh) options.onShow?.(cur);
  };

  /** The queued entry that goes next: the highest class, the oldest first. */
  const best = (): Entry | undefined => {
    let pick: Entry | undefined;
    for (const e of queue) {
      if (!pick || PRIORITY[e.item.cls] < PRIORITY[pick.item.cls]) pick = e;
    }
    return pick;
  };

  const take = (e: Entry) => {
    queue = queue.filter((x) => x !== e);
  };

  const meterItem = (r: MeterRun): Partial<Mutable> => ({
    text: meterLabel(r),
    cash: r.cash,
    pending: !r.qualifies,
    kind: r.kind,
  });

  const settle = () => {
    for (let guard = 0; guard < 32; guard++) {
      // Stale waiters go.
      const before = queue.length;
      queue = queue.filter(
        (e) => e.remainingMs !== null || now - e.queuedAt <= TICKER_MAX_WAIT_MS[e.item.cls],
      );
      if (queue.length !== before) version++;
      // The showing item's time.
      if (cur && cur.cls !== 'meter' && now >= cur.endsAt) {
        if (cur.held) cur.expired = true;
        else {
          cur = null;
          version++;
        }
      }
      const next = best();
      if (!cur) {
        if (next) {
          take(next);
          begin(next);
          continue;
        }
        if (run && styleOn) {
          cur = {
            id: nextId++,
            cls: 'meter',
            text: '',
            tag: undefined,
            cash: 0,
            count: 1,
            kind: undefined,
            contentRef: undefined,
            raceId: undefined,
            tick: undefined,
            landed: false,
            pending: false,
            startedAt: now,
            endsAt: Infinity,
            held: false,
            expired: false,
            remainingMs: null,
            ...meterItem(run),
          };
          version++;
        }
        return;
      }
      if (next && !cur.held && PRIORITY[next.item.cls] < PRIORITY[cur.cls]) {
        if (RESUMES.has(cur.cls)) {
          // Frozen with the time it has left; it keeps its id, so it goes before later items of its class.
          queue.push({
            id: cur.id,
            item: {
              cls: cur.cls,
              text: cur.text,
              ...(cur.tag !== undefined ? { tag: cur.tag } : {}),
              ...(cur.contentRef !== undefined ? { contentRef: cur.contentRef } : {}),
              ...(cur.raceId !== undefined ? { raceId: cur.raceId } : {}),
              ...(cur.tick !== undefined ? { tick: cur.tick } : {}),
            },
            count: cur.count,
            cash: cur.cash,
            queuedAt: now,
            remainingMs: Math.max(0, cur.endsAt - now),
          });
          queue.sort((a, b) => a.id - b.id);
        }
        cur = null;
        version++;
        take(next);
        begin(next);
        continue;
      }
      return;
    }
  };

  const overflow = () => {
    while (queue.length > TICKER_QUEUE_MAX) {
      let drop = queue[0];
      for (const e of queue) {
        if (!drop) break;
        const worse = PRIORITY[e.item.cls] > PRIORITY[drop.item.cls];
        if (worse) drop = e;
      }
      if (!drop) break;
      take(drop);
    }
  };

  const sum = (a: number | null, b: number | null | undefined): number | null =>
    a === null && (b === null || b === undefined) ? null : (a ?? 0) + (b ?? 0);

  return {
    push(item, t) {
      now = Math.max(now, t);
      if (isStyle(item.cls) && !styleOn) return;
      const cash = item.cash ?? null;
      if (item.cls === 'style' && item.kind !== undefined) {
        if (cur && cur.cls === 'style' && cur.kind === item.kind) {
          // A repeat of the chip showing: it grows and its time restarts.
          cur.count++;
          if (item.landed) cur.landed = true;
          cur.cash = sum(cur.cash, cash);
          cur.endsAt = now + dwellOf(item);
          cur.expired = false;
          version++;
          settle();
          return;
        }
        const same = queue.find((e) => e.item.cls === 'style' && e.item.kind === item.kind);
        if (same) {
          same.count++;
          same.cash = sum(same.cash, cash);
          same.queuedAt = now;
          settle();
          return;
        }
      }
      if (item.cls === 'bark') {
        // The latest bark wins over one still waiting.
        queue = queue.filter((e) => e.item.cls !== 'bark' || e.remainingMs !== null);
      }
      queue.push({ id: nextId++, item, count: 1, cash, queuedAt: now, remainingMs: null });
      overflow();
      settle();
    },
    meter(r, t) {
      now = Math.max(now, t);
      run = styleOn ? r : null;
      if (cur?.cls === 'meter') {
        if (!run) {
          cur = null;
          version++;
        } else {
          const next = meterItem(run);
          if (cur.text !== next.text || cur.cash !== next.cash || cur.pending !== next.pending) {
            Object.assign(cur, next);
            version++;
          }
        }
      }
      settle();
    },
    step(t) {
      now = Math.max(now, t);
      settle();
      const changed = version !== reported;
      reported = version;
      return { item: cur, changed };
    },
    extend(ref, voiceEndsMs) {
      if (!cur || cur.contentRef !== ref || cur.expired) return;
      const until = voiceEndsMs + TICKER_VOICE_TAIL_MS;
      if (until > cur.endsAt) cur.endsAt = until;
    },
    hold(on, t) {
      now = Math.max(now, t);
      settle();
      if (!cur || cur.cls === 'meter' || cur.held === on) return;
      cur.held = on;
      version++;
      if (!on && cur.expired) {
        cur.expired = false;
        cur.endsAt = now + TICKER_RELEASE_GRACE_MS;
      }
    },
    cut(ref) {
      const before = queue.length;
      queue = queue.filter((e) => e.item.contentRef !== ref);
      if (cur && cur.contentRef === ref) {
        cur = null;
        version++;
      } else if (queue.length !== before) version++;
      settle();
    },
    clearClass(cls) {
      queue = queue.filter((e) => e.item.cls !== cls);
      if (cur && cur.cls === cls) {
        cur = null;
        version++;
      }
      settle();
    },
    setStyleEnabled(on) {
      styleOn = on;
      if (on) return;
      run = null;
      queue = queue.filter((e) => !isStyle(e.item.cls));
      if (cur && isStyle(cur.cls)) {
        cur = null;
        version++;
      }
      settle();
    },
    current: () => cur,
    clear() {
      queue = [];
      cur = null;
      run = null;
      version++;
    },
    waiting: () => queue.map((e) => e.item),
  };
}

/** The item's words: the text, with the repeat count once there is more than one (`NEAR MISS ×3`). */
export function tickerLabel(item: Pick<ShownTickerItem, 'text' | 'count'>): string {
  return item.count > 1 ? `${item.text} ×${item.count}` : item.text;
}

/** The item's cash, such as `+$75`, or an empty string when it has none. */
export function tickerCash(item: Pick<ShownTickerItem, 'cash'>): string {
  return item.cash === null ? '' : `+$${Math.round(item.cash).toLocaleString('en-US')}`;
}

/**
 * A pop-up as a ticker item: a takedown's name flashes as a `name`, anything else is a `style` chip.
 * `landed` is a run that just paid out (the meter's chip landing on its award), held for `landMs`.
 */
export function popItem(pop: StylePop, landed = false, landMs?: number): TickerItem {
  return {
    cls: pop.name ? 'name' : 'style',
    text: pop.word,
    kind: pop.kind,
    cash: pop.points,
    ...(landed ? { landed: true, ...(landMs !== undefined ? { dwellMs: landMs } : {}) } : {}),
  };
}
