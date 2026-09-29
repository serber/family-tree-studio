# Architecture

## Data flow

The app is a unidirectional pipeline. Each stage is a separate module with its
own input/output types, and no stage mutates the data of the previous one:

```
GEDCOM text ──parseGedcom──▶ GedcomData ──buildTree──▶ DescendantTree ──computeLayout──▶ Layout ──update──▶ SVG
                src/viewer/gedcom/                src/viewer/tree/                     src/viewer/layout/            src/viewer/render/
```

Changes are processed from the earliest affected stage only:

- a setting changed → recompute `Layout → SVG` only;
- another root family selected → from `DescendantTree`;
- a new file loaded → the whole pipeline.

## Modules

### `src/viewer/gedcom` — parser
`parseGedcom(raw): GedcomData` turns text into `Map<Individual>` and
`Map<Family>`. Two-phase parsing: lines are tokenized first
(`level / @xref@ / TAG / value`), then a small state machine assembles
INDI/FAM records. Details in [gedcom.md](gedcom.md).

### `src/viewer/tree` — descendant tree
`buildTree(data, rootFamilyId): DescendantTree` builds a tree whose node is a
**descendant together with every union they founded**, not a single family:

- spouses in a node are ordered blood-line first (`entrySpouseId`) — the one
  who is a child of the parent family — followed by one per union;
- a child who founded several families (remarriages) stays **one** node, and
  `marriages` lists each union in display order; the layout gives every union
  its own spouse cell over its own children;
- each child records the union it descends from in `parentFamilyId`, which is
  how the layout groups children by union;
- a child with no union of their own becomes a leaf with id `single:<indiId>`;
- cycle protection (marriages between relatives): a visited-family set; on
  re-entry the family stays where it was first placed. A descendant whose every
  union is already drawn elsewhere still appears, as a `single:` leaf;
- the root couple has no blood line to pivot on, so both spouses get a card and
  the further unions of *either* of them extend the root node — otherwise those
  branches, and all their descendants, would be missing from the chart.

`listRootCandidates(data)` returns candidate root families: progenitors first
(neither spouse has a FAMC), sorted by descendant count within each group.

### `src/viewer/layout` — layout
`computeLayout(tree, settings, measure): Layout` (`fan.ts`) is a pure function
and the only place where geometry is computed; `track.ts` holds the ring shape
(circle or stadium) and its `(u, d)` coordinates. Knows nothing about DOM or
D3 — text widths come in through the injected `measure`. The algorithm is
described in [layout.md](layout.md).

### `src/viewer/render` — renderer
The `TreeRenderer` class owns the SVG scene:

- the skeleton (layers `rings → links → cells → core`, zoom behavior,
  ResizeObserver) is built once in the constructor;
- `update(layout, settings)` re-renders the scene through keyed D3 joins —
  moving a slider updates attributes of existing elements without recreating
  the DOM;
- zoom/pan live on a persistent `.zoom-layer` group and survive any update;
  `fitToContent(layout.bounds)` fits the tree into the window, `focus(point)`
  zooms to one spot (search);
- **all styling is set via SVG presentation attributes, not CSS** — a
  deliberate decision: the serialized SVG is self-contained and the export
  does not depend on external styles;
- a cell is a band path (`bandPath`; a rectangle for cards written across the
  ring); a name written along the ring runs on a `<textPath>` (its path
  reversed on the lower half) only where the ring visibly bends under it —
  where the sag over its width, w²/8r, is under 1.5 px it is a straight line
  on the tangent, turned upright. A textPath places and turns every glyph on
  its own and repaints that way on every zoom step: on the 973-person tree the
  167 of them cost more than all other text together (27 remain); names written across it are turned 180° on the
  left half — no name is ever upside down;
- names are cut with «…» by measured width (`measureText`, a canvas at the
  chart font — the same function the layout sizes cells with);
- clicking a cell re-roots the chart on that person's union
  (`onSelectFamily`); `setSearch` outlines matching names and fades the rest
  (by classes and fill/stroke opacity — per-cell `opacity` on a thousand
  groups is composited group by group). There is deliberately no hover
  effect: the pointer crosses cells constantly while panning, and restyling
  the chart on every crossing made dragging stutter;
- the core is a disc (sector, pill) cut into one band per root spouse.

### `src/viewer/export` — JPEG export
A native chain: “clone SVG → XMLSerializer → `<img>` → canvas → JPEG”, with
no third-party libraries. Details in [export.md](export.md).

### `src/viewer/ui` — settings panel
Controls are **generated** from the `controlGroups` descriptor array
(`ui/controls.ts`) instead of being hand-written in HTML. This eliminates the
whole class of “markup id drifted away from the handler” bugs. How to add a
new setting: see [settings.md](settings.md).

### `src/viewer/i18n.ts` — translations
The product-wide i18n (`src/shared/i18n`, intl-messageformat over
`messages/{ru,en}.json`) bound to the `viewer` namespace: `t('status.stats')`
reads `viewer.status.stats`. The locale comes from the URL (`/viewer/` is
English, `/ru/viewer/` Russian); the language switch changes it in place.
Deep modules never format messages: parser/tree/export throw `AppError` with a
code (`src/shared/errors.ts`), and the UI layer translates via `errors.<code>`.

### `src/viewer/ViewerApp.tsx` — the page
A React component that renders the static markup (sidebar, stage, status bar)
and its text, then calls `mountViewer` on mount and its teardown on unmount.
React never touches the children of the nodes the app fills imperatively (the
chart, the settings panel, both selects, the status line).

### `src/viewer/app.ts` — wiring
Owns the application state (`data`, `tree`, `layout`, `settings`) and wires
up the panel, file loading (button + drag & drop), root selection (including
click-to-re-root with a «← Назад» history), search, export, the status bar
and the language switcher. A settings change is handled once per animation
frame (a dragged slider fires faster than a large tree lays out, and handling
every event would make the chart trail the slider), and the layout is
recomputed only when the tree, a geometry setting or the measured font
changed — colors and strokes (`STYLE_ONLY`) re-render the old layout. When a web font finishes loading it clears the
measured widths and lays the chart out again. On locale change React re-renders
the static text; the app rebuilds the settings panel (keeping collapsed states),
repopulates the selects and re-renders the chart for translated tooltips.
`mountViewer` returns a teardown that removes every listener and the SVG
(StrictMode mounts twice in development).

## Key decisions (and why)

| Decision | Motivation |
| --- | --- |
| Separate pipeline stages with typed boundaries | The previous implementation mixed parser, layout and rendering in one 1200-line IIFE; geometry was written directly into tree nodes |
| Layout as a pure function | Recomputing on every slider move is safe and cheap; the module is testable in Node without a browser |
| SVG skeleton built once, updates via joins | Previously every change recreated the whole scene including the zoom behavior |
| Styles as SVG attributes | Export serializes the SVG as-is; no CSS inlining required |
| Control descriptors | HTML and handlers cannot drift out of sync |
| Export without dom-to-image | The library was heavy and produced unpredictable scale; native serialization is deterministic |
