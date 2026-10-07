import { loadChunk } from '../content';

/** How a lazy chunk is loaded: content/'s `loadChunk` (caught, tried once more by a new URL, said once). */
export type ChunkLoader = <T>(name: string, load: () => Promise<T>) => Promise<T | null>;

/**
 * render/'s lazy chunks and when one that failed is asked for again (polish batch F's check, punch item 4;
 * polish batch O's check, mustFix 1).
 *
 * A chunk that failed both of `loadChunk`'s tries "gives up": it is not asked for again frame after frame,
 * so a build whose files are gone is not hammered. It is asked for again at the next road (`newRoad`) and
 * at the next race start (`raceStart`), a rematch on the same road included. A part whose ask is not
 * made every frame (the verge, the landmarks, the models) hands its own request to `later`, and the race
 * start runs it.
 */
export interface ChunkGate {
  /** The chunk's module, or null when it failed both tries or gave up since the last road or race start. */
  chunk<T>(name: string, load: () => Promise<T>): Promise<T | null>;
  /** Runs `ask` at the next race start (once, however often it is handed over); a new road forgets it. */
  later(ask: () => void): void;
  /** A new road: every chunk may be asked for again, by the new road's own requests. */
  newRoad(): void;
  /** A race starts: every chunk may be asked for again, and each part's handed-over request runs. */
  raceStart(): void;
  /** The chunks that gave up, in the order they did. */
  gaveUp(): string[];
}

export function createChunkGate(load: ChunkLoader = loadChunk): ChunkGate {
  const gaveUp = new Set<string>();
  const asks = new Set<() => void>();
  return {
    async chunk(name, importer) {
      if (gaveUp.has(name)) return null;
      const m = await load(name, importer);
      if (m === null) gaveUp.add(name);
      return m;
    },
    later(ask) {
      asks.add(ask);
    },
    newRoad() {
      gaveUp.clear();
      asks.clear();
    },
    raceStart() {
      gaveUp.clear();
      const due = [...asks];
      asks.clear();
      for (const ask of due) ask();
    },
    gaveUp: () => [...gaveUp],
  };
}
