// The voice cap (docs/architecture.md, "Audio": 32 voices by default, with priority-based
// stealing). Every effects voice, long or short, holds a slot: when the pool is full, a new voice
// takes the slot of the lowest-priority voice playing (the oldest among equals), or is dropped if
// everything playing ranks above it. Music is scheduled on its own and does not count.

export interface Stoppable {
  stop(): void;
}

export interface PoolEntry {
  readonly priority: number;
  readonly voice: Stoppable;
  readonly seq: number;
}

export class VoicePool {
  private max: number;
  private seq = 0;
  private readonly entries = new Set<PoolEntry>();

  constructor(max = 32) {
    this.max = Math.max(1, Math.floor(max));
  }

  get size(): number {
    return this.entries.size;
  }

  /** Adds a voice, stealing if needed. Returns its entry, or null (and stops it) if dropped. */
  add(priority: number, voice: Stoppable): PoolEntry | null {
    if (this.entries.size >= this.max) {
      const victim = this.lowest();
      if (!victim || victim.priority > priority) {
        voice.stop();
        return null;
      }
      this.entries.delete(victim);
      victim.voice.stop();
    }
    const entry: PoolEntry = { priority, voice, seq: this.seq++ };
    this.entries.add(entry);
    return entry;
  }

  /** Frees a slot (the voice ended or was stopped by its owner). */
  release(entry: PoolEntry): void {
    this.entries.delete(entry);
  }

  has(entry: PoolEntry): boolean {
    return this.entries.has(entry);
  }

  setMax(max: number): void {
    this.max = Math.max(1, Math.floor(max));
    while (this.entries.size > this.max) {
      const victim = this.lowest();
      if (!victim) break;
      this.entries.delete(victim);
      victim.voice.stop();
    }
  }

  private lowest(): PoolEntry | null {
    let best: PoolEntry | null = null;
    for (const e of this.entries) {
      if (!best || e.priority < best.priority || (e.priority === best.priority && e.seq < best.seq)) best = e;
    }
    return best;
  }
}
