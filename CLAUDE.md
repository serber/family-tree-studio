# Family Tree Studio

One product, two tools, one stack: a **family tree editor** (enter and verify a genealogy, save GEDCOM) and a **radial tree visualizer** (GEDCOM → circular descendant chart → print-size JPEG), plus a short home page linking to both. Domain: `https://treestudio.app`. Everything runs in the browser; no server, accounts or telemetry.

The two tools were separate apps (`../family-tree-editor`, React; `../radial-family-tree`, vanilla TS + D3) and were merged here on 2026-09-29 with their behaviour unchanged. The old folders are reference only — don't modify them.

## Commands

```sh
npm run dev                                  # Vite on http://127.0.0.1:5173 — /, /editor/, /viewer/, /ru/…
npm run build                                # typecheck (both tsconfigs) + vite build + page generation
npm run typecheck                            # tsc -p tsconfig.json && tsc -p tsconfig.viewer.json
npm test                                     # Vitest, src/**/*.test.ts
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e   # Playwright via installed Chrome; starts its own dev server
PLAYWRIGHT_CHANNEL=chrome npx playwright test -g "3,000"   # one e2e test by title
```

No linter or formatter is configured.

## Structure

| Path | Role |
| --- | --- |
| `index.html`, `editor/index.html`, `viewer/index.html` | Page templates with `<!--page-head-->`, `<!--page-body-->`, `<!--page-noscript-->` placeholders |
| `scripts/pages.ts` | Vite plugins: per-locale head metadata, `/ru/…` pages (dev rewrite + build copies), landing pre-render, sitemap/robots |
| `messages/{ru,en}.json` | The only UI text: namespaces `common`, `meta`, `landing`, `editor`, `viewer` (ICU, next-intl convention) |
| `src/shared/i18n/` | `t()`, locale from URL, `setLocale` (in place + `history.replaceState`), `useLocale()` hook |
| `src/shared/styles/` | Design system: layers, tokens (light/dark), base, components, utilities; self-hosted Manrope |
| `src/shared/components/` | `BrandMark`, `LangSwitch` |
| `src/shared/errors.ts` | `AppError(code, params)` and its Worker transport (`errorToData` / `errorFromData`) |
| `src/landing/` | Home page (`Landing.tsx`), hydrated entry, SSR `render.tsx` used at build time |
| `src/editor/` | The editor — see `docs/editor/` |
| `src/viewer/` | The visualizer — see `docs/viewer/` |
| `tests/` | Playwright: `editor.spec.ts`, `gedcom.spec.ts` (editor workflows), `studio.spec.ts` (home, visualizer, languages) |

Docs: `docs/editor/` (STATUS, PLAN, GEDCOM_SUPPORT, usage), `docs/viewer/` (architecture, layout, gedcom, settings, export, development), `docs/deployment.md`. Keep them in sync with the code, in English.

## Product-wide rules

- **Language.** Every visible string comes from `messages/{ru,en}.json`; both files always have the same keys (a unit test checks keys, ICU syntax and that every thrown error code has a message). Pages are English at `/…` and Russian at `/ru/…` (`DEFAULT_LOCALE` / `PREFIXED_LOCALE` in `src/shared/i18n`, mirrored in `scripts/pages.ts`); the URL is the source of truth. Unit tests run in the default locale (English) — pass `'ru'` explicitly when a test checks Russian output. Switching the language never reloads an app or loses state. Deep modules (model, parsers, layout, Workers) throw `AppError` codes, never text; the UI translates with `t('errors.<code>')` of its namespace. Russian name logic (patronymics, genitive, surname forms) is data behaviour and stays active in English.
- **Styles.** Cascade layers `base, vendor, components, app, utilities` (declared in `src/shared/styles/index.css`); page CSS lives in `@layer app`, React Flow's CSS in `vendor`. Colors only via tokens in `tokens.css` (light + dark); chart colors in the visualizer are user settings, not tokens. Shared building blocks (`.btn*`, `.icon-btn`, `.input`, `.select`, `.segmented`, `.brand`, `.lang-switch`) go in `components.css`; don't restyle them per page. One UI font everywhere: Manrope (`--font-sans`); Spectral only for text inside the radial chart and its JPEG export.
- **Privacy.** No network calls with genealogy data, no telemetry, no remote fonts or assets. No server, accounts, or collaboration unless the user asks.
- **Pages.** Separate entries (multi-page Vite), not a SPA: each tool keeps its own global state and CSS. Links between pages are plain `<a href>` built with `pageUrl(page, locale)`.
- UI text is in the catalogs; code, comments, docs, and commit messages in English.

## Editor (src/editor)

Local-first GEDCOM editor. Primary use case: transcribing a tangled paper family tree of ~1,000 people (partly via an AI-generated GEDCOM that must be verified person by person), so fast data entry, navigation in a large graph, and data safety come first. Target scale 2,000–3,000 people on one canvas. Keep the UI simple.

| Path | Role |
| --- | --- |
| `model/tree.ts` | `TreeDocument` schema 2, relationship index, lineage, search, validation, v1 migration |
| `model/ops.ts` | Pure structural edits: add/link/unlink relatives, delete, merge, cycle checks, ID allocation, review marks |
| `model/names.ts`, `dates.ts` | Russian patronymics, surname forms, genitive; Russian/English ↔ GEDCOM dates |
| `model/history.ts` | Snapshot undo/redo with coalescing of consecutive edits to one field |
| `model/issues.ts` | Consistency checks («Замечания»): kinds, IDs and numbers only — worded in the UI |
| `gedcom/` | Line-tree parser, source-patching exporter, skeleton for new trees, Worker + client |
| `layout/` | Couple-block layout on dagre, in a Worker |
| `components/` | `TreeCanvas` (React Flow, LOD, "+" actions), `Inspector`, `CommandPalette`, `Views`, `TopBar`, `Overlays` |
| `App.tsx` | Boot/welcome, editor state, autosave, keyboard shortcuts, document replacement |
| `storage.ts` | IndexedDB draft + rolling snapshots (keys keep the old `rodnye:` prefix), downloads |

Invariants:
- **Graph, not tree.** A person can be in several families; ancestry cycles are rejected on import and by every linking operation.
- **Model ≠ renderer.** People/families never hold coordinates or React Flow objects; positions come from the layout Worker.
- **One canvas, automatic layout.** No manual card dragging; spouses are always adjacent.
- **Workers.** GEDCOM parsing/export and layout run in Web Workers. Layout depends only on the structure key (person IDs + family links + marriage order of people married more than once), never on names, places, or other dates.
- **GEDCOM preservation.** Keep unknown tags and unrelated records. Unchanged input must export byte-identical. Before changing GEDCOM behaviour, read `docs/editor/GEDCOM_SUPPORT.md`, add a fixture and an exact-output test. Never call export "lossless" beyond what fixtures prove.
- **Review marks stay out of GEDCOM** (`TreeDocument.verified`: draft, snapshots, JSON backups only).
- **IDs never reused.** Allocate new IDs only through `idAllocator`.
- **Safe replacement.** Imports/restores validate fully first; replacing a document with undownloaded changes asks for confirmation and always takes a snapshot.

Conventions: dense code style (long single-line JSX) — match nearby style, keep new logic readable. Reversible destructive actions use an undo toast instead of a confirmation. Name suggestions are prefilled but always editable; patronymics are only offered as a click-to-apply suggestion. The user controls navigation: an action like marking a person checked must not move the selection (selecting a newly created relative is the one exception). Components that are memoized (e.g. `PersonNode`) call `useLocale()` so they re-render on a language switch.

## Visualizer (src/viewer)

Unidirectional pipeline, one module per stage, DOM-free below the renderer:

```
GEDCOM text → GedcomData → DescendantTree → Layout → SVG
  gedcom/       tree/          layout/       render/
```

`ViewerApp.tsx` renders the static markup with React; `app.ts` (`mountViewer`) owns the state (`data`, `tree`, `layout`, `settings`) and fills the chart, settings panel, selects and status line imperatively; it returns a full teardown (StrictMode mounts twice in dev). The settings panel is generated from `controlGroups` descriptors in `ui/controls.ts` — to add a setting, extend `Settings` + `defaultSettings`, add a descriptor, add `viewer.controls.<key>` to both catalogs, consume it in layout/renderer. Settings changes recompute only `Layout → SVG`, once per animation frame, and skip the layout for style-only keys (`STYLE_ONLY`). All chart styling is SVG presentation attributes (export is self-contained); the JPEG export inlines the self-hosted Spectral faces as data URIs — no external libraries, keep it that way. Algorithm details: `docs/viewer/layout.md`; settings semantics: `docs/viewer/settings.md`.

The visualizer is additionally checked with `tsconfig.viewer.json` (`noUncheckedIndexedAccess`, `noImplicitOverride`); its layout/tree/gedcom modules can be run directly in Node (Node 24 strips types) — see `docs/viewer/development.md`. Sample data: `examples/example-large.ged` (489 people, synthetic, with two second marriages).

## Workflow

- After changes: `npm run build` and `npm test`. When UI behaviour changes, also run the e2e suite.
- Look at the result in a browser (Playwright screenshot or `/run`) for visual changes — both languages and both color schemes when styles change.
- Performance: measure, don't assume. The 3,000-person e2e test prints timings. Record machine, browser, dataset, and method.
- When an editor milestone is complete, update `docs/editor/STATUS.md`: what was done, the checks you actually ran, limitations, and the exact next step.
- Do not commit, push, or deploy unless asked.
