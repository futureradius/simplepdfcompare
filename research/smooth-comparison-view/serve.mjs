// RESEARCH (throwaway) for issue #11: serves the bench page and the comparison prototype
// on this computer only (127.0.0.1). Static files only; samples/ holds only the synthetic
// pair made by `npm run samples`.
//
//   node research/smooth-comparison-view/serve.mjs     (run.mjs starts it by itself)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
// sibling-test-plan.pdf: simplepdfclipper's generated Test Plan (its `npm run testplan`), copied here.
const allowed = ["research/smooth-comparison-view/", "prototypes/detection/", "prototypes/alignment/", "prototypes/comparison/", "node_modules/mupdf/dist/", "samples/down-", "samples/right-", "samples/ground-truth.json", "samples/sibling-test-plan.pdf"];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".pdf": "application/pdf", ".json": "application/json" };

export function serve(port = 5219) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(root, p);
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (req.method !== "GET" || rel.startsWith("..") || !allowed.some((a) => rel.startsWith(a)) || !types[path.extname(file)] || !fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)], "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await serve();
  console.log("http://127.0.0.1:5219/research/smooth-comparison-view/bench.html");
}
