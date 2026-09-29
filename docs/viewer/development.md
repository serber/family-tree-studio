# Development

## Commands

```bash
npm install
npm run dev        # Vite dev server with hot reload
npm run build      # tsc --noEmit (strict typecheck) + build into dist/
npm run preview    # serve the built dist/ locally
npx tsc --noEmit   # typecheck only
```

The build is static (`base: './'` in `vite.config.ts`) — `dist/` can be
served from any static hosting or opened from the file system.

## Stack

- **TypeScript** in strict mode (`strict`, `noUncheckedIndexedAccess`).
- **D3 v7** — only select/join, zoom and arc; the layout is custom (see
  [layout.md](layout.md)).
- **Vite 6** — dev server and build.
- No test framework, no linter.

## Verifying changes

### DOM-free modules

`gedcom/`, `tree/`, `layout/` deliberately do not depend on DOM/D3 — they run
directly in Node (Node ≥ 23 executes TypeScript without transpilation):

```bash
node --eval "
import('./src/viewer/gedcom/parser.ts').then(async ({ parseGedcom }) => {
  const { readFileSync } = await import('node:fs');
  const data = parseGedcom(readFileSync('examples/demo-family.ru.ged', 'utf-8'));
  console.log(data.individuals.size, data.families.size);
});
"
```

Useful layout invariants to check, on every variant (fan / cards, circle /
stadium, 360° / 180°, compactness 0 / 0.5 / 1) and on the real trees as well
as the sample: coordinates are finite; neighbouring cells of one band are at
least `cardSpacing` apart (mod 1 on a full circle); cells stay inside the
opening; every person of the tree has a cell (or sits in the core); a name
written along a ring fits its cell; in the cards style every node has one
line and no two lines of different parents cross. Also run the edge cases —
a childless root, a single child, one person with three unions (one of them
childless). Re-run these after any change to `tree/` or `layout/` rather than
eyeballing a screenshot.

### The whole app

Screenshot in headless Chrome:

```bash
npx vite --port 5199 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --window-size=1600,1000 --virtual-time-budget=6000 \
  --screenshot=/tmp/app.png http://localhost:5199/
```

For click scenarios (file upload, export) the repo has no browser driver
installed — no `puppeteer`, `playwright` or `chromium-cli`. Rather than adding
one, start Chrome with `--remote-debugging-port=9222` and drive it over the
DevTools protocol from Node's built-in `WebSocket`: fetch
`http://localhost:9222/json` for the page target, then `Runtime.evaluate` to
act on the page and `Page.captureScreenshot` (with a `clip` and a `scale`) to
grab a magnified crop of one node. To load a `.ged` through the real file
input, build a `File`, put it on a `DataTransfer`, assign `input.files` and
dispatch a `change` event.

The export blob is best captured by wrapping `URL.createObjectURL` (the link
is revoked right after the click, so a `fetch(blobUrl)` after the fact won't
work).

Note: d3 transitions (the fit-to-view animation) do not finish in headless
screenshots — that's why the auto-fit on load is instant, and only the
button is animated.

### Test data

- `examples/demo-family.ru.ged` and `examples/demo-family.en.ged` — the product's demo family in each language (300 people, one progenitor couple, every 11th descendant marries twice; the Russian Lesnov family with patronymics and gendered surnames, the English Harper family without). The editor opens the file of the current language as its demo and the visualizer shows it on startup; both fetch the same assets. They are written from the editor's `createDemo(count, locale)` by `npm run demo` (a unit test fails when they are stale); `tests/fixtures/demo-3000.ged` is the Russian family grown to 3,000 people for the e2e scale test. Loaded by `src/viewer/gedcom/sample.ts` (a `?url` import, fetched
  once) on startup and by the Sample button. Its remarriages show that a person
  keeps a single cell, that the spouse band splits between the two wives, and
  that each wife's cell sits over her own children. Generation stops at 300
  people, so the outermost ring is only partly filled.
- For structure that the sample lacks, test on real trees of the shapes that
  motivated the fan layout: a patrilineal record with no spouses and no sex
  (narrow top, 200+ people per ring in the middle, many leaves at every
  depth), a tree starting with a long line of single descent, and a broad
  couples tree.

## Structure

```
src/viewer/
  main.tsx        page entry: shared styles, viewer.css, <ViewerApp />
  ViewerApp.tsx   static markup (React) + mount/unmount of the app
  app.ts          state and wiring (mountViewer)
  i18n.ts         t() bound to the `viewer` namespace of messages/{ru,en}.json
  settings.ts     Settings type, defaults, print sizes
  gedcom/         GEDCOM decoding and parser (types, decode, parser, sample)
  tree/           descendant tree (build)
  layout/         ring geometry and the fan / cards layout (track, fan)
  render/         TreeRenderer + palette (renderer, palette)
  export/         JPEG export (exportJpeg)
  ui/             descriptors and panel generation (controls)
  viewer.css      page styles (do not affect the SVG scene)
```

`AppError` lives in `src/shared/errors.ts`, the translations in `messages/`.
