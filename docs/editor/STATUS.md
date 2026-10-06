# Project status

Updated: 2026-10-06.

## 2026-10-06: closing a tree, deleting autosaved versions

- «Файл → Закрыть дерево» / "Close tree" (also in the Ctrl+K palette) returns to the welcome screen, like closing a solution in an IDE. It asks only when there are undownloaded changes (same rule as replacement), waits for a pending autosave, takes a snapshot (skipped for a blank new tree nobody typed into), and deletes the IndexedDB draft, so a reload stays on the welcome screen.
- The welcome screen shows «Автосохранённые версии (N)» when versions exist; picking one opens it as the working tree (marked as not downloaded).
- The autosaved versions dialog can delete a single version (trash button, inline confirmation in the row) or all versions («Удалить все», inline confirmation with the count). Deletion is irreversible, so it confirms instead of using an undo toast. `deleteSnapshots(savedAt?)` in `storage.ts`.
- `snapshotNow` no longer adds a copy identical to the newest snapshot (closing or replacing a tree right after it was opened used to leave two equal versions).
- Checks: `npm run build` passed; `npm test` 118 passed; e2e 16 passed (new: "closes the tree to the welcome screen, reopens it from an autosaved version, and deletes versions"). Screenshots of the File menu, welcome screen and both confirmation states checked in Russian/light and English/dark.

## 2026-09-29: merged into Family Tree Studio

The editor («Родные») became the editor of Family Tree Studio (`/editor/`), next to the radial visualizer (`/viewer/`) and a home page, on one React + Vite stack. Behaviour is unchanged; what changed around it:
- The UI is bilingual: every string moved to `messages/{ru,en}.json` (`editor.*`). The language switches in place (RU/EN in the top bar and on the welcome screen) without losing the tree, selection or undo history; `/editor/` is English, `/ru/editor/` Russian (English is the default language of the product).
- Model, GEDCOM and layout errors are `AppError` codes (`src/shared/errors.ts`), passed out of Workers as data and translated in the UI. Issues («Замечания») and GEDCOM import warnings are stored as codes + values and worded at render time (older drafts with string warnings still display).
- Dates are shown in the current language and accepted in Russian or English (`abt. 1900`, `before 1917`, `12 Mar 1900`, `(O.S.)` …); Russian parsing is unchanged. Parentage reads «сын Петра и Анны» / "son of Pyotr and Anna".
- Styles moved to the shared design system (`src/shared/styles`: tokens, cascade layers) and were split by area in `src/editor/styles/`; React Flow CSS is in the `vendor` layer. The UI font is Manrope (self-hosted) instead of system fonts. Side-by-side fields in the person panel now start on one line (the second column used to sit 8 px lower).
- Product name: new GEDCOM skeletons say `SOUR FAMILY_TREE_STUDIO`; backups download as `*.treestudio.json`. IndexedDB keys keep the `rodnye:` prefix so existing drafts still open.
- Checks: `npm run build` passed; `npm test` 117 passed (the editor's 110 plus catalog and English-date tests); e2e 15 passed (the 12 editor/GEDCOM workflows unchanged apart from the URL, plus 3 new: home page, visualizer, editor in English with a language switch). 3,000-person timings in Chrome 154 on this Mac: layout 287 ms, search 539 ms, selection 108 ms, keystroke median 39–50 ms across runs.

## 2026-09-29 (later): one demo family

- The product has one demo family of 300 people in two versions: `examples/demo-family.ru.ged` (the Lesnov family) and `examples/demo-family.en.ged` (the Harper family, English names, no patronymics), written from `createDemo(count, locale)` by `npm run demo`. The editor opens the file of the current language («Посмотреть на примере», File → «Демо: 300 человек») through the normal GEDCOM import, the visualizer shows it on startup; both fetch the same assets. The 100-, 1,000- and 3,000-person menu items are gone; `createDemo` stays as the generator and for tests. The e2e scale test opens `tests/fixtures/demo-3000.ged` (the same family, 3,000 people) as a GEDCOM file.
- Fixed a canvas bug the larger demo exposed (it existed in the original editor too): when a layout arrived while the table or issues view was open, React Flow measured the new cards at 0 × 0 under `display: none` and drew NaN coordinates on return. The hidden canvas now keeps its layout (`visibility: hidden`).
- Checks: `npm run build` passed; `npm test` 118 passed (new: the committed demo files match the generator and import/export byte-identically; the English file has no Cyrillic); e2e 15 tests passed twice in a row (`--repeat-each 2`, 30/30).

The editor's own milestones below are unchanged.

## Current milestone

Milestone 3 (complete editing workflows) is done, and the product was redesigned around the user's actual task: transcribing a tangled ~1,000-person paper tree into GEDCOM. Milestone 4 (layout and performance) is partly done. See `docs/editor/PLAN.md`.

## Added 2026-09-24 (later): review mode and card colors

The user generated a ~1,000-person GEDCOM from a photo of the paper tree with an AI and needs to verify every person.
- «Режим проверки» (top bar): unchecked cards have a red border and «!», checked cards a green ✓; the zoomed-out view and the mini-map are colored the same way; progress «N из M» with a bar.
- Person panel review bar: «Проверено» / «Снять» and a separate «Следующий» (go to the nearest unchecked relative by family links). Marking never moves the selection — navigation stays under the user's control (user request). Shortcut: `Space` toggles the mark. Marks are undoable.
- Table: status dot and filter (all / unchecked / checked).
- Marks live in `TreeDocument.verified` (ID → time), saved with the draft/snapshots/backups, removed when a person is deleted or merged away, never exported to GEDCOM, and never trigger relayout.
- Cards are filled by sex (blue/pink/grey) in light and dark themes.
- Row order is fixed by the layout itself (`orderRanks` in `src/editor/layout/layout.ts`, a dagre `customOrder` replacing its crossing minimisation): each rank is ordered top-down, a node follows its parent with the longest ancestry, siblings keep their recorded order, and a person's unions follow the partners' seats in the couple block. Parents of someone who married in are placed right after the relative whose line they married into. A person married more than once sits between the spouses with the earlier marriage on the left, so children of later marriages are drawn to the right; the order is by marriage year where both are known, otherwise as recorded (`orderUnions`, also used for the marriage list in the person panel), and it is part of the layout structure key. Before, dagre re-optimised the whole row on every edit, so adding one child could swap whole cousin groups to the other side (reported on a real file). Now the same structure always gives the same order, and an added person does not move other groups. Checks: regression test on the reported shape (fails on the old ordering), in-law placement test, determinism test; 0 parent→child line crossings on the 100/1,000/3,000 demos (dagre also had 0); layout in Node 1,000 people 76 ms (was 160), 3,000 people 319 ms (was 692); e2e 3,000-person layout 293 ms in the Worker. In randomly tangled stress graphs, siblings pushed to different generation rows by cross-generation marriages cannot be ordered on one line.
- The data-checks tab was renamed «Замечания» to avoid confusion with review mode. React Flow attribution is visible again (top-right), as its license terms request.
- Checks: `npm run build` passed; `npm test` 101 passed; e2e 11 tests passed twice in a row (`--repeat-each 2`, 22/22), including a review-mode test that verifies the GEDCOM export is unchanged by marks.

## Completed in this milestone

**Model and GEDCOM**
- Schema 2 document: patronymic, birth surname, sex, birth/death places, marriage date/place; every document has a GEDCOM source (new trees get a 5.5.1 skeleton); monotonic ID counters so deleted IDs are never reused. Schema-1 drafts are migrated.
- Pure structural operations (`src/editor/model/ops.ts`): add father/mother/spouse/son/daughter/brother/sister, link existing people as parent/spouse/child/sibling, unlink, delete, merge duplicates, cycle prevention.
- Russian helpers: patronymic from father's name and back (exception table + ~120 common names), surname gender forms, genitive for «сын Ивана и Анны», Russian ↔ GEDCOM dates including qualifiers, ranges, periods, and Julian calendar.
- Structural GEDCOM export: new/deleted records, pointer cleanup, two-sided link reconciliation limited to changed relationships, new fields patched in place.
- Snapshot undo/redo (300 steps) with coalescing of typing into one step.
- Consistency checks: possible duplicates, death before birth, parent too young/old, birth after a parent's death, unrecognized dates, isolated people, no name, unknown sex.

**Interface**
- Welcome screen: new tree, open GEDCOM, demo.
- Canvas: couple-block layout (spouses always adjacent, marriage line with a junction, stepped lines to children), "+" buttons on the selected card, lineage highlighting with toggle, level of detail by zoom, minimap, view anchored on the selected card across relayouts, reveal/center/fit commands.
- Person panel: clicking a card without a given name puts the cursor in the name field (a named card is only selected, so shortcuts keep working); fields save as you type; date fields show the parsed result; patronymic suggestion; relatives grouped by parents, each marriage with its children, siblings; add/link/unlink everywhere; merge and delete with undo toast; back/forward navigation.
- Ctrl+K palette: ranked people search with parentage and places, commands, pick mode for linking and merging.
- Table view (virtualized, sortable, filter) and «Проверка» view (grouped issues, GEDCOM warnings, merge button for duplicates).
- Keyboard shortcuts independent of layout (physical keys of О/М/П/С/Д/Б), spatial arrow navigation, help dialog.
- Autosave to IndexedDB, `navigator.storage.persist()`, rolling snapshots (every 10 minutes and before replacement; 12 kept, 3 for sources over 2 MB), "not downloaded" status, confirmation only when undownloaded work would be replaced.
- Light and dark themes via CSS tokens; system fonts only.

## Verification (2026-09-24)

- `npm run build`: passed (strict TypeScript + production build). Vite warns that the main chunk is 524 kB (165 kB gzip).
- `npm test`: 100 tests passed in 4 files: model operations, merge, history, checks, migration, names/dates (with round trips), layout (spouse adjacency, no overlaps), GEDCOM preservation, and structural export with exact expected output. Includes a 1,000-person export → import round trip.
- `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`: 10 tests passed (11 after review mode); the full suite also passed 3 times in a row (`--repeat-each 3`, 30/30).
- Screenshots of the welcome screen, data entry, search, table, checks, 3,000-person tree, and dark theme were inspected.
- Measured (3,000-person demo, e2e test "loads 3,000 people…"): layout 355 ms in the Worker; 1.1–1.3 s from choosing the demo to a rendered canvas; keystroke-to-paint in the name field median 38 ms, max 53–57 ms; selecting a card 111–118 ms (Playwright click to panel update); search → reveal 520 ms, which includes a 350 ms pan animation. Layout benchmark in Node: 1,000 people 162 ms, 3,000 people 552 ms.
- Environment: macOS arm64, Node 24.14.1, headless Chrome 153, 1440×1000 viewport, Vite dev server, no CPU throttling. Synthetic data only; no FPS measurement.

Bugs found and fixed during this work: partners were placed ~1,200 px apart on average by plain dagre (fixed with couple blocks); viewport commands produced NaN transforms while the canvas was hidden behind another view (now deferred until visible); shortcuts stopped working when focus stayed on a hidden file input.

## Known limitations

- No real user GEDCOM file or real paper-tree transcription session has been tested. GEDCOM `5.5`, CP1251/ANSI, ANSEL, and UTF-16 are rejected.
- Only the projected fields are editable. Other events, sources, media, shared notes, and adoption details are preserved but not shown. Deleting or merging removes the deleted person's whole record, including such data.
- Very broad generations make the tree extremely wide (the 3,000 demo is ~300,000 px wide); the minimap is then nearly empty. Children are shown in recorded order, not sorted by birth date, and cannot yet be reordered in the UI.
- Pedigree collapse and cousin marriages are supported by the model, but the layout may draw long crossing lines.
- A person with three or more spouses: the third spouse is not adjacent, and that marriage line crosses a card.
- One working tree per browser. Snapshots live in the same browser storage as the draft.
- Undo history does not survive reload (the draft and snapshots do).
- JSON backup parsing runs on the main thread.
- Narrow screens: the panel overlays the canvas; no dedicated mobile layout.

## Next concrete step

Test with real data: the user's AI-generated GEDCOM (~1,000 people) from the paper-tree photo. Then:

1. Import it; record parse failures (encoding, version, malformed lines typical of AI output) and decide on CP1251/`5.5` support with fixtures.
2. Walk through part of it in review mode; note what slows verification (e.g. needing to see the photo side by side, per-field marks, comments on doubtful people).
3. Enter 50–100 people from the paper tree in a timed session; note every extra click or unclear step and fix the top issues.
4. Profile pan/zoom on a 1,000-person real tree and decide whether children ordering and generation-width reduction are needed.

## Resume

Read `CLAUDE.md`, then this file, then `git status` and `git log`. Continue from the next concrete step.
