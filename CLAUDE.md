# simplepdfcompare

Compares two versions of a vector PDF construction schedule and shows what was Added and Removed. One HTML file, opened from `file://` in Edge, fully offline. AGPL-3.0-or-later.

## Vocabulary and decisions

- Use the words of `GLOSSARY.md` (Plan, Document, Place, Body, Offset ...) in code, comments, docs and commits. A new domain word goes into the glossary first.
- `docs/adr/` holds the decisions. Read the ADRs a task names before changing the area. A change that contradicts an ADR needs a new ADR.
- Build plan: issue "Build simplepdfcompare v1" (#31) and its slice sub-issues. One slice per session, branch `build/<slice-slug>` from `main`, PR to `main`, never merged by the agent.

## Stack

TypeScript + Vite, plain DOM (no framework), MuPDF.js in Web Workers, one worker per Plan (ADR 0004). Vitest for logic, Playwright with channel `msedge` for e2e against the built single file.

- `npm run dev`, `npm run build` (one `dist/index.html`), `npm test`, `npm run e2e` (needs `npm run build` and `npm run samples` first).
- `npm run samples` writes synthetic pairs and `ground-truth.json` (planted changes and controls) to the git-ignored `samples/`. Test logic first against it. A fixture that needs a binary (such as the three-page Document in `src/testing/multipage.ts`) is generated in code, never committed.

## The sibling: simplepdfclipper

Local copy `C:\code\simplepdfclipper`. Look and controls are taken over from it (ADR 0009). Copy code from it, then adapt; never import it as a package. Name every deviation from its behaviour in the PR. Its ADRs 0001, 0004, 0008, 0010, 0012, 0014 are the reference for build, start page, busy window and page picker.

## Prototypes

The prototypes are throwaway and stay on their branches. Port their logic, never merge or import them: `prototype/difference-detection` (detection), `prototype/alignment` (setup, variant A), `prototype/comparison-view` (view, Places, naming, filter, variant A), `research/smooth-comparison-view` (smooth view).

## Rules

- **Language:** UI text is German. Code, comments, identifiers and docs are English.
- **Confidentiality:** real Plans are confidential. Real PDFs and the git-ignored `test/` folder (read `test/NOTES.md`) are opened only locally. Commits, PRs, issues and code comments carry nothing from them; checks against them report counts only. Tests use synthetic samples.
- **Test first:** red, then green, via the `mattpocock-skills:tdd` skill. Logic in Vitest; click-through behaviour in Playwright.
- **UI habits:**
  - Nothing does heavy work before its result is shown.
  - Nothing jumps: selecting or hiding never moves the Plan or the list.
  - CAD-style selection boxes, Explorer-style list selection, Excel-style filters.
  - Ctrl for held shortcuts, since Shift triggers Sticky Keys.
- **Done** means the slice's checklist is ticked, `npm test` and `npm run e2e` pass, and `dist/index.html` opens from `file://` in Edge with no network.
- Commit messages and PR bodies end with the attribution lines the session gives.
