import { describe, expect, it, vi } from "vitest";
import { ComparisonHandoff } from "./handoff";
import type { ComparisonResult } from "../compare/result";

const result = (offset: number): ComparisonResult => ({
  timeDirection: "down",
  setup: { axis: "y", offset, old: { body: [0, 10], ignored: [] }, new: { body: [0, 10], ignored: [] } },
  axisZones: { old: {}, new: {} },
  comparison: { window: [0, 10], marks: [], links: [], counts: { old: 0, new: 0, unchanged: 0, added: 0, removed: 0 } },
  places: [],
  offsetCandidates: [],
  ms: { compare: 0, places: 0, transfer: 0 },
});

describe("handing a comparison result to the Vergleich tab", () => {
  it("tells every listener about each result, in order", () => {
    const h = new ComparisonHandoff();
    const a = vi.fn(),
      b = vi.fn();
    h.subscribe(a);
    h.subscribe(b);
    h.publish(result(1));
    h.publish(result(2));
    expect(a.mock.calls.map((c) => c[0].setup.offset)).toEqual([1, 2]);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("gives a listener that comes late the latest result at once", () => {
    const h = new ComparisonHandoff();
    h.publish(result(1));
    h.publish(result(2));
    const late = vi.fn();
    h.subscribe(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0]![0].setup.offset).toBe(2);
  });

  it("keeps the latest result to read", () => {
    const h = new ComparisonHandoff();
    expect(h.latest()).toBeUndefined();
    h.publish(result(3));
    expect(h.latest()?.setup.offset).toBe(3);
  });

  it("stops telling a listener that unsubscribed", () => {
    const h = new ComparisonHandoff();
    const a = vi.fn();
    const off = h.subscribe(a);
    off();
    h.publish(result(1));
    expect(a).not.toHaveBeenCalled();
  });

  it("forgets the result when cleared (the Plans changed), and tells no one", () => {
    const h = new ComparisonHandoff();
    h.publish(result(1));
    const a = vi.fn();
    h.clear();
    h.subscribe(a);
    expect(h.latest()).toBeUndefined();
    expect(a).not.toHaveBeenCalled();
  });
});
