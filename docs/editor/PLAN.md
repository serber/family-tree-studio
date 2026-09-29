# Implementation plan

The primary use case (confirmed 2026-09-24): the user is transcribing a tangled paper family tree of about 1,000 people into GEDCOM. Priorities follow from that: fast entry of relatives, connecting separately entered branches, navigating a large graph, catching transcription mistakes, and never losing work.

## Milestone 1 — runnable prototype and scale check ✅

React/TypeScript/Vite with React Flow, renderer-independent model, deterministic demo trees, layout in a Worker, search, side panel, undo/redo, autosave, backups.

## Milestone 2 — preserve data through GEDCOM import/export ✅

Line-tree parser, 5.5.1/7.0 detection, encoding rejection, transactional import in a Worker, exact-preservation fixtures, minimal field patches.

## Milestone 3 — complete editing workflows ✅ (2026-09-24)

- Add parents, children, siblings, and spouses from the card and the panel, with Russian name suggestions.
- Link existing people; merge duplicates; unlink; delete with undo. Several families per person. Cycle prevention.
- Fields: patronymic, birth surname, sex, birth/death places, marriage date and place. Russian date input.
- Structural GEDCOM export (new/deleted records, link reconciliation) in the original version; new trees export as 5.5.1.
- Snapshot undo history; every structural change is one step.

Remaining from the original milestone: multiple names, events, notes, and citations editing (preserved, not editable); adoption/biological relationship types; reordering children.

## Milestone 4 — genealogy layout and performance (partly done)

Done: couple blocks keep spouses adjacent; junctions on the marriage line; the view stays anchored on the selected card across relayouts; 3,000-person timings are measured in e2e.

Next:
- Test real 1,000–3,000-person files and deliberately difficult graphs (pedigree collapse, cousin marriages, many remarriages).
- Order children by birth date when known; reduce the width of very broad generations.
- Measure pan/zoom FPS on an agreed device. Targets: no sustained freezes, search/edit feedback within 100 ms, 30+ FPS navigation. These are targets, not guarantees.
- Consider another renderer only after profiling React Flow.

## Milestone 5 — everyday reliability

- Real-file testing, including the user's own export from other programs (encodings, `5.5`, CP1251).
- Keyboard access and accessibility audit, narrow screens.
- Save to a chosen file with the File System Access API (repeated Ctrl+S overwrites the same file).
- Printable/exportable views (PDF or image of a branch).
- Offline/PWA after persistence stabilizes. Publishing requires a separate request.
