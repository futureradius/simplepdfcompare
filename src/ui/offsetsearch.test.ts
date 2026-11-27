import { describe, expect, it, vi } from "vitest";
import { OffsetSearch } from "./offsetsearch";
import type { OffsetResult } from "../compare/offset";

const found = (offset: number): OffsetResult => ({ offset, votes: 5, candidates: [{ offset, votes: 5 }] });
const none: OffsetResult = { offset: 0, votes: 0, candidates: [] };

/** A search whose runs are finished by hand. */
function harness() {
  const runs: { key: string; signal: AbortSignal; finish: (r: OffsetResult) => void; fail: (e: Error) => void }[] = [];
  const changed = vi.fn();
  const search = new OffsetSearch(
    (key, signal) =>
      new Promise<OffsetResult>((resolve, reject) => {
        runs.push({ key, signal, finish: resolve, fail: reject });
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    changed,
  );
  return { runs, changed, search };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the Offset search of the Versatz tab", () => {
  it("starts when the tab is entered and shows that it runs", () => {
    const { runs, search } = harness();
    search.enter("k1");
    expect(runs).toHaveLength(1);
    expect(search.state).toBe("searching");
  });

  it("keeps the result, and does not search again for the same setup", async () => {
    const { runs, search } = harness();
    search.enter("k1");
    runs[0]!.finish(found(560));
    await tick();
    expect(search.state).toBe("done");
    expect(search.result?.offset).toBe(560);
    search.leave();
    search.enter("k1");
    expect(runs).toHaveLength(1);
    expect(search.result?.offset).toBe(560);
  });

  it("searches again when the setup changed", async () => {
    const { runs, search } = harness();
    search.enter("k1");
    runs[0]!.finish(found(560));
    await tick();
    search.leave();
    search.enter("k2");
    expect(runs).toHaveLength(2);
    expect(search.state).toBe("searching");
  });

  it("is cancelled on leaving, and starts again on the next visit", async () => {
    const { runs, search } = harness();
    search.enter("k1");
    search.leave();
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(search.state).toBe("idle");
    await tick();
    expect(search.state).toBe("idle");
    search.enter("k1");
    expect(runs).toHaveLength(2);
    expect(runs[1]!.signal.aborted).toBe(false);
  });

  it("drops a result that arrives after the search was cancelled", async () => {
    const { runs, changed, search } = harness();
    search.enter("k1");
    search.leave();
    runs[0]!.finish(found(560));
    await tick();
    expect(search.result).toBeUndefined();
    expect(changed).not.toHaveBeenCalledWith("done");
  });

  it("does not run twice when entered again while it runs", () => {
    const { runs, search } = harness();
    search.enter("k1");
    search.enter("k1");
    expect(runs).toHaveLength(1);
  });

  it("cancels a running search for another setup before it starts the new one", () => {
    const { runs, search } = harness();
    search.enter("k1");
    search.enter("k2");
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(runs).toHaveLength(2);
  });

  it("says none when the search found no candidate", async () => {
    const { runs, search } = harness();
    search.enter("k1");
    runs[0]!.finish(none);
    await tick();
    expect(search.state).toBe("none");
  });

  it("says failed when the search broke, and tries again on the next visit", async () => {
    const { runs, search } = harness();
    search.enter("k1");
    runs[0]!.fail(new Error("boom"));
    await tick();
    expect(search.state).toBe("failed");
    search.leave();
    search.enter("k1");
    expect(runs).toHaveLength(2);
  });

  it("tells when its state changes", async () => {
    const { runs, changed, search } = harness();
    search.enter("k1");
    runs[0]!.finish(found(1));
    await tick();
    expect(changed.mock.calls.map((c) => c[0])).toEqual(["searching", "done"]);
  });

  it("forgets its result for another Plan", async () => {
    const { runs, search } = harness();
    search.enter("k1");
    runs[0]!.finish(found(1));
    await tick();
    search.reset();
    expect(search.result).toBeUndefined();
    expect(search.state).toBe("idle");
    search.enter("k1");
    expect(runs).toHaveLength(2);
  });
});
