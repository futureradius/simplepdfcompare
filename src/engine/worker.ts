/// <reference lib="webworker" />
import * as core from "./core";
import type { Request, Response } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Requests the UI asked to stop (the Offset search checks between its pieces). */
const cancelled = new Set<number>();
const yieldToQueue = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

scope.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  try {
    let result: unknown;
    switch (req.op) {
      case "init":
        result = await core.init(req.wasmBinary);
        break;
      case "openDocument":
        result = core.openDocument(req.bytes);
        break;
      case "discardDocument":
        result = core.discardDocument();
        break;
      case "openPage":
        result = core.openPage(req.page);
        break;
      case "renderRegion": {
        const t = core.renderRegion(req.region);
        scope.postMessage({ id: req.id, ok: true, result: t } satisfies Response, [t.pixels.buffer]);
        return;
      }
      case "bodyHints":
        result = core.bodyHints(req.axis);
        break;
      case "snapSegments": {
        const s = core.snapSegments();
        scope.postMessage({ id: req.id, ok: true, result: s } satisfies Response, [s.h.buffer, s.v.buffer]);
        return;
      }
      case "extractObjects": {
        const { objects, extractMs } = core.planObjects();
        result = { count: objects.length, extractMs };
        break;
      }
      case "planObjects":
        result = core.planObjects();
        break;
      case "findOffset": {
        const { op: _op, id, ...input } = req;
        try {
          result = await core.findOffset(input, { pause: yieldToQueue, cancelled: () => cancelled.has(id) });
        } finally {
          cancelled.delete(id);
        }
        break;
      }
      case "cancel":
        cancelled.add(req.target);
        break;
      case "compare": {
        const { op: _op, id: _id, ...input } = req;
        result = core.runComparison(input);
        break;
      }
      case "renderThumbnail": {
        const t = core.renderThumbnail(req.thumb);
        scope.postMessage({ id: req.id, ok: true, result: t } satisfies Response, [t.pixels.buffer]);
        return;
      }
    }
    scope.postMessage({ id: req.id, ok: true, result } satisfies Response);
  } catch (e) {
    scope.postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies Response);
  }
};
