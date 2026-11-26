# simplepdfcompare

Compare two versions of a vector PDF construction schedule: line up their Bodies by
eye (Header and Footer stay put, the schedule in between shifts along the time
direction) and show on screen what was **Added** (red) and what was **Removed**
(yellow, dashed x–x–x outline).

Runs fully local, like its sibling [simplepdfclipper](https://github.com/futureradius/simplepdfclipper):
no server, no upload.

> Status: building v1 (skeleton and start page done). See [`GLOSSARY.md`](GLOSSARY.md) for the domain and the
> `wayfinder:map` issue for the open decisions.

## Run

```sh
npm install
npm run dev      # dev server
npm run build    # one file: dist/index.html, opens from file:// in Edge
npm test         # Vitest
npm run e2e      # Playwright in Edge (needs build and samples first)
```

## Sample Plans

Real Plans are confidential, so development runs against synthetic pairs:

```sh
npm install
npm run samples
```

writes to `samples/` (git-ignored) an Old/New pair with time running down (a 14 m
time-distance diagram), a small pair with time running right (a bar chart), and
`ground-truth.json` with each pair's Offset, Header/Body/Footer bounds, the planted
changes (with the Added/Removed boxes they must produce) and controls that look
different but are not Differences.

## License

AGPL-3.0-or-later (planned to bundle MuPDF.js, as the sibling does). See [`LICENSE`](LICENSE).
