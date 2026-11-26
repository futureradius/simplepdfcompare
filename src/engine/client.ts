// UI-side engine handle: one Web Worker with MuPDF per Plan (ADR 0004). The worker is
// inlined as a data: URL so it works from file://. There is no main-thread fallback:
// two Plans would share the engine's state there.

import wasmGzBase64 from "virtual:mupdf-wasm";
import EngineWorker from "./worker?worker&inline";
import type { DocumentInfo, PlanInfo, Preview, RequestBody, Response, ThumbnailRequest } from "./protocol";

export interface Engine {
  /** Opens a file as a candidate; the current Plan stays until openPage. */
  openDocument(bytes: ArrayBuffer): Promise<DocumentInfo>;
  discardDocument(): Promise<void>;
  /** Makes a page of the Document the Plan. */
  openPage(page: number): Promise<PlanInfo>;
  renderThumbnail(thumb: ThumbnailRequest): Promise<Preview>;
  terminate(): void;
}

async function decodeWasm(): Promise<ArrayBuffer> {
  const bin = atob(wasmGzBase64);
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/**
 * Edge refuses module workers from blob: URLs on file:// pages, but accepts them
 * from data: URLs. Vite's inline worker falls back to a data: URL when
 * createObjectURL yields nothing, so suppress it for this call.
 */
function createEngineWorker(): Worker {
  if (location.protocol !== "file:") return new EngineWorker();
  const original = URL.createObjectURL;
  URL.createObjectURL = () => "";
  try {
    return new EngineWorker();
  } finally {
    URL.createObjectURL = original;
  }
}

function workerEngine(wasm: ArrayBuffer, timeoutMs: number): Promise<Engine> {
  const worker = createEngineWorker();
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  worker.onmessage = (ev: MessageEvent<Response>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.result);
    else p.reject(new Error(ev.data.error));
  };

  const call = <T>(req: RequestBody, transfer: Transferable[] = []): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...req, id }, transfer);
    });

  return new Promise<Engine>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("worker init timed out"));
    }, timeoutMs);
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(`worker error: ${e.message}`));
    };
    call({ op: "init", wasmBinary: wasm }, [wasm]).then(
      () => {
        clearTimeout(timer);
        resolve({
          openDocument: (bytes) => call<DocumentInfo>({ op: "openDocument", bytes }, [bytes]),
          discardDocument: () => call<void>({ op: "discardDocument" }),
          openPage: (page) => call<PlanInfo>({ op: "openPage", page }),
          renderThumbnail: (thumb) => call<Preview>({ op: "renderThumbnail", thumb }),
          terminate: () => worker.terminate(),
        });
      },
      (e: Error) => {
        clearTimeout(timer);
        worker.terminate();
        reject(e);
      },
    );
  });
}

/** Starts the two engines, one per Plan, in parallel. */
export async function startEngines(): Promise<[Engine, Engine]> {
  const wasm = await decodeWasm();
  return Promise.all([workerEngine(wasm.slice(0), 30000), workerEngine(wasm, 30000)]);
}
