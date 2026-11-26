// The seam between "Versatz" and "Vergleich": "Vergleichen" publishes a ComparisonResult here
// (marks, Places and the setup used), and the "Vergleich" tab listens. The view of the
// comparison needs nothing else from the setup tabs.

import type { ComparisonResult } from "../compare/result";

export type ComparisonListener = (result: ComparisonResult) => void;

export class ComparisonHandoff {
  private last: ComparisonResult | undefined;
  private readonly listeners = new Set<ComparisonListener>();

  /** A new result: every listener hears it. It replaces the earlier one. */
  publish(result: ComparisonResult): void {
    this.last = result;
    for (const l of [...this.listeners]) l(result);
  }

  /** Listens for results; a result that is already there is handed over at once. Returns the way to stop. */
  subscribe(listener: ComparisonListener): () => void {
    this.listeners.add(listener);
    if (this.last) listener(this.last);
    return () => this.listeners.delete(listener);
  }

  /** The latest result, if there is one. */
  latest(): ComparisonResult | undefined {
    return this.last;
  }

  /** Forgets the result, because the Plans or what was opened changed. Tells no one. */
  clear(): void {
    this.last = undefined;
  }
}
