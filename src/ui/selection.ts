// The selection (ADR 0003): one set of Places, shared by the list and the Plan, which may be
// empty. Click, Ctrl and Shift work as in Windows Explorer; the boxes on the Plan add and
// remove (picking.ts). It holds Place numbers and tells its listener when it changed.

export class Selection {
  private readonly set = new Set<number>();
  /** Where a Shift range starts: the Place clicked last. */
  private rangeFrom: number | null = null;
  onChange: (() => void) | undefined;

  get size(): number {
    return this.set.size;
  }

  has(no: number): boolean {
    return this.set.has(no);
  }

  nos(): number[] {
    return [...this.set];
  }

  /** The Place clicked last, where a Shift range starts. */
  get anchor(): number | null {
    return this.rangeFrom;
  }

  /** Sets the selection to exactly these; tells the listener only if it differs. */
  private assign(next: Iterable<number>): void {
    const a = [...this.set].sort((x, y) => x - y).join(","),
      n = [...new Set(next)];
    this.set.clear();
    for (const x of n) this.set.add(x);
    if (a !== [...this.set].sort((x, y) => x - y).join(",")) this.onChange?.();
  }

  clear(): void {
    this.assign([]);
  }

  only(no: number): void {
    this.rangeFrom = no;
    this.assign([no]);
  }

  replace(nos: Iterable<number>): void {
    this.assign(nos);
  }

  add(nos: Iterable<number>): void {
    this.assign([...this.set, ...nos]);
  }

  remove(nos: Iterable<number>): void {
    const gone = new Set(nos);
    this.assign([...this.set].filter((n) => !gone.has(n)));
  }

  /** Ctrl + click. */
  toggle(no: number): void {
    this.rangeFrom = no;
    if (this.set.has(no)) this.remove([no]);
    else this.add([no]);
  }

  /**
   * Shift + click: everything from the Place clicked last to `to`, in the list's `order`
   * (with `add`, Ctrl + Shift, to the selection). The range keeps its start.
   */
  range(order: readonly number[], to: number, add: boolean): void {
    const b = order.indexOf(to);
    if (b < 0) return;
    let a = this.rangeFrom === null ? -1 : order.indexOf(this.rangeFrom);
    if (a < 0) a = 0;
    const part = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const start = this.rangeFrom !== null && order.includes(this.rangeFrom) ? this.rangeFrom : order[0]!;
    this.assign(add ? [...this.set, ...part] : part);
    this.rangeFrom = start;
  }

  /** Drops what is no longer shown (filtered out, hidden). */
  prune(keep: (no: number) => boolean): void {
    this.assign([...this.set].filter(keep));
    if (this.rangeFrom !== null && !keep(this.rangeFrom)) this.rangeFrom = null;
  }
}
