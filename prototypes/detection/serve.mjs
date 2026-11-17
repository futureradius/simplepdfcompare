// PROTOTYPE (throwaway): serves compare.html on this computer only (127.0.0.1).
// Static files only: the prototype folder and MuPDF's dist folder. No uploads, no other
// routes. Your PDFs are opened by the browser from disk and never reach this server.
//
//   npm run proto:compare
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
// samples/ holds only the synthetic pair (npm run samples), for the "Try the synthetic pair" button.
const allowed = ["prototypes/detection/", "node_modules/mupdf/dist/", "samples/down-", "samples/right-", "samples/ground-truth.json"];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".pdf": "application/pdf", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") { res.writeHead(302, { location: "/prototypes/detection/compare.html" + url.search }).end(); return; }
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

let port = 5199;
server.on("error", (e) => { if (e.code === "EADDRINUSE" && port < 5210) server.listen(++port, "127.0.0.1"); else throw e; });
server.on("listening", () => console.log(`Open http://127.0.0.1:${port}/  (Ctrl+C to stop; reachable from this computer only)`));
server.listen(port, "127.0.0.1");
