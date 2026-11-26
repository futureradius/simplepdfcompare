// When the Offset search runs (ADR 0002, "heavy work starts only when its result is shown"):
// it starts on entering "Versatz", stops on leaving, and is not repeated for a setup it has
// already searched. Pure logic around one injected search, unit-tested.

import type { OffsetResult } from "../compare/offset";

export type SearchState = "idle" | "searching" | "done" | "none" | "failed";

export class OffsetSearch {
  state: SearchState = "idle";
  result: OffsetResult | undefined;
  /** What the result (or the running search) belongs to. */
  private key: string | undefined;
  private abort: AbortController | undefined;

  /**
   * @param run the search for a setup (`key` says which); it rejects with an AbortError when its signal aborts
   * @param changed called with the new state whenever it changes
   */
  constructor(
    private readonly run: (key: string, signal: AbortSignal) => Promise<OffsetResult>,
    private readonly changed: (state: SearchState) => void = () => {},
  ) {}

  private set(state: SearchState): void {
    this.state = state;
    this.changed(state);
  }

  /** The tab is shown for this setup: searches unless that is done or running already. */
  enter(key: string): void {
    if (this.key === key && (this.state === "searching" || this.state === "done" || this.state === "none")) return;
    this.stop();
    this.key = key;
    this.result = undefined;
    const abort = (this.abort = new AbortController());
    this.set("searching");
    this.run(key, abort.signal).then(
      (r) => {
        if (abort.signal.aborted) return;
        this.abort = undefined;
        this.result = r;
        this.set(r.candidates.length ? "done" : "none");
      },
      () => {
        if (abort.signal.aborted) return;
        this.abort = undefined;
        this.set("failed");
      },
    );
  }

  /** The tab is left: a running search stops (a finished one is kept). */
  leave(): void {
    if (this.state !== "searching") return;
    this.stop();
    this.key = undefined;
    this.set("idle");
  }

  /** The Plans changed: forget everything. */
  reset(): void {
    this.stop();
    this.key = undefined;
    this.result = undefined;
    if (this.state !== "idle") this.set("idle");
  }

  private stop(): void {
    this.abort?.abort();
    this.abort = undefined;
  }
}
