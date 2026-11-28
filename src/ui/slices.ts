// Painting the mark tiles in short slices (issue #57, ADR 0011): no main-thread task is
// longer than a slice, so the page answers input and draws frames while tiles are painted.
// A canvas keeps what it is told to draw and rasterizes it later, all at once: so a tile is
// painted in batches, each made to rasterize before the next, and a batch draws as many
// items as fit in its time. Pure logic, no DOM.

/** How many items the next batch draws, so that a batch (drawing and rasterizing) takes about `targetMs`. */
export class BatchSizer {
  private n: number;
  constructor(
    private readonly targetMs: number,
    opts: { first?: number } = {},
  ) {
    this.n = opts.first ?? 16;
  }

  size(): number {
    return this.n;
  }

  /** A batch of `n` items took `ms`. */
  took(n: number, ms: number): void {
    const fit = ms > 0 ? Math.floor((n * this.targetMs) / ms) : Infinity;
    this.n = Math.max(1, Math.min(2 * n, fit));
  }
}

export interface Clock {
  now(): number;
  /** Runs `fn` soon, in a task of its own (after input and frames that are due). */
  later(fn: () => void): void;
}

/** The view's tiles come first; tiles painted ahead only when there are none. */
export type Lane = "view" | "ahead";
const LANES: Lane[] = ["view", "ahead"];

/** A job: started when it first runs, then stepped; each step should take a few ms at most. */
export interface Job {
  key: string;
  start: () => Iterator<unknown>;
}

interface Queued extends Job {
  it?: Iterator<unknown>;
}

/**
 * Runs jobs step by step in slices of about `sliceMs` (asked again for each slice), each slice
 * a task of its own.
 */
export class SliceRunner {
  private readonly lanes = new Map<Lane, Queued[]>(LANES.map((l) => [l, []]));
  private scheduled = false;

  constructor(
    private readonly clock: Clock,
    private readonly opts: { sliceMs: number | (() => number); may?: (lane: Lane) => boolean; onError?: (e: unknown) => void },
  ) {}

  /** Nothing to run. */
  get idle(): boolean {
    return LANES.every((l) => !this.lanes.get(l)!.length);
  }

  /** The jobs waiting in a lane (the started one included). */
  pending(lane: Lane): number {
    return this.lanes.get(lane)!.length;
  }

  /** A lane that had to wait may run now. */
  kick(): void {
    this.schedule();
  }

  /** Stops every job (what the tiles show changed). */
  clear(): void {
    for (const l of LANES) {
      for (const j of this.lanes.get(l)!) j.it?.return?.();
      this.lanes.set(l, []);
    }
  }

  /** The first lane with a job that may run now. */
  private lane(): Lane | undefined {
    return LANES.find((l) => this.lanes.get(l)!.length && (this.opts.may?.(l) ?? true));
  }

  /**
   * The jobs of a lane, in order. A job already started that is still listed goes on first
   * (it is not started again); a started job no longer listed is stopped.
   */
  set(lane: Lane, jobs: readonly Job[]): void {
    const was = this.lanes.get(lane)!;
    const wanted = new Set(jobs.map((j) => j.key));
    const started = was.filter((j) => j.it && wanted.has(j.key));
    for (const j of was) if (j.it && !wanted.has(j.key)) j.it.return?.();
    const keep = new Set(started.map((j) => j.key));
    this.lanes.set(lane, [...started, ...jobs.filter((j) => !keep.has(j.key)).map((j) => ({ ...j }))]);
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || !this.lane()) return;
    this.scheduled = true;
    this.clock.later(() => {
      this.scheduled = false;
      this.slice();
    });
  }

  private slice(): void {
    const t0 = this.clock.now(),
      ms = this.opts.sliceMs;
    const budget = typeof ms === "number" ? ms : ms();
    while (this.clock.now() - t0 < budget) {
      const lane = this.lane();
      if (!lane) return;
      const q = this.lanes.get(lane)!,
        j = q[0]!;
      try {
        j.it ??= j.start();
        if (j.it.next().done) q.shift();
      } catch (e) {
        q.shift();
        this.opts.onError?.(e);
      }
    }
    this.schedule();
  }
}
