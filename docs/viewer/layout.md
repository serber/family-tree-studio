# Layout algorithm

All computation lives in `src/viewer/layout/fan.ts` — the pure function
`computeLayout(tree, settings, measure): Layout` — on top of the ring
geometry in `src/viewer/layout/track.ts`. Input: the descendant tree, the settings
and a text measuring function; output: finished geometry (cells, lines, rings,
core, bounding box). It mutates nothing and touches neither DOM nor D3.

`measure(text, fontSize, bold)` is injected so the module stays DOM-free: the
app passes `measureText` (a canvas `measureText` at the chart font, cached,
`src/viewer/render/renderer.ts`); Node scripts use `approximateMeasure`.

## The picture

The root family sits in the **core** at the center. Every generation below it
is a **ring**, and every person on a ring is a **cell**: a band `[d0, d1]` of
distance over a stretch `[u0, u1]` of the ring.

- **Fan** (`chartStyle: 'fan'`, the default): a cell reaches over the whole
  sector of its descendants, as far as its neighbours allow — a sunburst.
  Parentage reads from the nesting, so no lines are drawn.
- **Cards** (`'cards'`): a cell only as wide as its own name needs, in the
  middle of its place, joined to its parent by a smooth line; the rings keep
  room for those lines between them.

Both come from the same layout; only the last steps (cell extents, lines)
differ.

## Coordinates

`track.ts` defines the shape every ring follows: all points at distance `d`
from the **spine** `[-half, half]` on the x axis — a stadium (two half circles
joined by straight sides), or a circle at `half = 0`. A stadium, unlike an
ellipse, stays a stadium when offset, so every ring is again one, the gap
between two rings is the same all the way round, and all rings share their
normals.

Positions are `(u, d)`: `u` is arc length along a reference ring as a
fraction of its perimeter (u = 0 the leftmost point, 0.25 the top, 0.75 the
bottom; it wraps), `d` the distance from the spine. On a circle `u` is simply
the angle. Useful primitives:

- `locate(track, u, d)` → point and the outward normal there;
- `arcLength(track, u0, u1, d)` — exact arc length along the ring at `d`;
- `uForArc(track, arc, rho)` — the widest stretch of `u` an arc of `arc` px at
  distance `rho` may need anywhere round the ring. Round the ends an arc shrinks
  with distance, along the sides it doesn't, so the ends are the worst case; on
  a circle this is exactly `arc / (2π·rho)`. All widths the packing works with
  are measured this way, so they hold wherever a cell ends up;
- `bandPath` / `arcLinePath` — SVG paths of a cell and of a text line along a
  ring (true SVG arcs on a circle, sampled polylines on a stadium).

The **opening** (`fanAngle`) is the stretch of `u` the chart uses: all of it
at 360°, otherwise `[0.25 − s/2, 0.25 + s/2]` — a fan standing on its base,
opening upwards (180° is the classic half-fan).

## Ring modes and thickness

Each ring writes its names one of two ways:

- **arc** — along the ring. The ring is one text line thick (two with the
  years), and each cell as wide as its name. Right for sparse generations:
  three to six people round the top of a tree become a thin band instead of a
  wide ring of mostly empty sectors, and a lone generation (a line of single
  descent) is a full circle with its name on it.
- **radial** — across the ring. The ring is as thick as its longest name
  (measured, capped at `cardLength`), each cell only `cardThickness` wide.
  Right for dense generations.

A ring holding spouses has two bands: the descendants inside (`inner` →
`split`), the people they married outside (`split` → `outer`). A descendant
without a spouse cell takes both bands. With `spousesBeside` there is one
band and the spouses stand next to their partner instead (see below).

`arcRings` sets how many inner rings go along the arc; `-1` (auto) decides:
starting with every ring radial, rings 1, 2, … are switched to arc one by one
while that keeps the chart's outer radius within 4 % of the best so far; the
first ring that would grow it more stops the search. The trials judge the
radius by the `tight` bound (each ring alone fits, see below), which needs no
packing: judged by the full solve, every trial would pack the whole tree some
thirty times, and the search ran on every slider step (on the 973-person tree:
20 ms → 9 ms per layout; the choice came out the same on all but two of 68
test cases, one of them a smaller chart).

Within a radial ring a single cell may still write along the ring when it
came out wide enough (the ancestors of large branches mostly). A cell written
along the ring grows its name font — up to 2.2× — as far as the name fits
both along and across; the years keep their size.

## Packing: a radial tidy tree

The widths every cell needs are known (in `u`, via `uForArc`, at the rings'
current distances). The tree is then packed bottom-up, Reingold–Tilford
style:

- every subtree carries its **contour** — its left and right edge on every
  ring below its root;
- the children of a node are placed left to right, each one as close to those
  before it as *every* ring allows: the gap at the children's own ring is
  `cardSpacing` (plus `familyGap` between children of different unions of the
  same parent), and on every deeper ring — where the two subtrees hold cousins —
  `cardSpacing + familyGap`;
- the same is done right to left, and the two packings are **averaged**: a lone
  small subtree between two big ones would otherwise stick to whichever side
  the pass starts from. The no-overlap conditions are linear in the offsets, so
  the average of two valid packings is valid too;
- the parent is centered over its first and last child.

Unlike a plain sunburst, where every leaf keeps its column all the way out,
subtrees interlock: a large family's grandchildren may sit above a neighbour
who had no children. (The bundled trees show why this matters: one of them
has 555 leaves but at most 209 people on any ring, so a sunburst would need a
ring 2.65 times as long.)

The packed width on each ring must fit the opening. On a full circle every
ring with two or more cells also needs a gap across the seam (at the bottom).
The result is a **scale**: how much the packing may be stretched to fill the
opening, `< 1` when it doesn't fit.

## How far out the rings go

The rings' thickness is given by their mode and names; what's left to choose
is how far out they sit. Any ring could be pushed out on its own, but pushing
the core pushes them all — relieving every ring — for the same growth of the
chart, so the **core grows**. Two bounds, both found by bisection (the tests
only get easier as the radius grows):

- `tidy` — the packing fits unchanged (scale ≥ 1); every parent stays exactly
  centered over its children;
- `tight` — each ring on its own holds its cells and gaps; no smaller chart is
  possible.

`compactness` (0…1) picks the growth between them:
`tight + (1 − compactness)·(tidy − tight)`.

If the packing fits (scale ≥ 1), it is stretched to fill the opening. If not,
it is shrunk to fit, which makes neighbours overlap, and every ring is then
**spread** on its own by `spreadRing`: keeping their order, the cells move as
little as possible (least squares) until neighbours are their widths plus gaps
apart. Rings are spread from the outermost in, and a parent aims for the
middle of its children as they finally stand, so it stays over them where its
own ring allows. With cumulative offsets `c` the positions are `x = y + c` and the
constraints become "`y` is non-decreasing" — an isotonic regression, solved by
pool-adjacent-violators; the bounds of the opening (or, on a circle, the
closing gap across the seam, with the best window found by ternary search)
clip the solution. `tight` sized every ring for exactly this, so the spread
always succeeds: **neighbouring cells are never closer than their gaps, on any
ring, at any compactness**.

### Where the growth goes

All of it in the core would leave a large empty disc whenever the outer rings
are crowded and the inner ones sparse (a line of single descent over a broad
bottom). So the growth is shared evenly by the core and as many inner rings as
can take it without the packing getting tighter — moving room outwards brings
those rings in, and the test is that every ring still fits on its own and the
scale drops by no more than 0.5 %. In the fan style it thickens those rings
(and their names grow with them); in the cards style it widens the gaps before
them, lengthening the lines.

## Cell extents

**Cards.** Cards written across the ring are drawn as rectangles, and the
cards of one node on one band form a **row** (`Cell.row`): they stand side by
side on the normal through the row's middle (`rowPoint`, `track.ts`), so a
couple stays flush — each card on its own normal would part from its
neighbour like fingers, wider outwards. Lines start and end on those straight
edges. A card is exactly its own width at its place: the width is inverted
from arc length by bisection (exact where a stadium's end meets its side). A
person married several times gets a card reaching over all their spouses'
cards.

**Fan**, in two passes over the rings:

1. From the outermost ring in, each cell covers its own width and its
   children's final cells, as far as its neighbours leave room — where two
   want the same stretch, the boundary goes halfway, never into either one's
   own width.
2. From the core out, each cell grows into the free room beside it, up to
   halfway to its neighbour — but never past its parent's cell: children fill
   their parent's sector, they don't spill over a neighbour who had none. The
   room above a childless person stays empty, which is what it means.

A generation of one person runs all the way round (`Cell.full`, drawn as an
annulus).

**Spouses beside** (`spousesBeside`): a ring has one band, and a node's own
width is its descendant's plus all its spouses'. Cards stand shoulder to
shoulder, the descendant first, the row centered on the node, and a union's
line leaves from the seam before its spouse's card. In the fan the node's
final cell is shared between the partners in proportion to those widths.

**Spouses.** With one union the spouse cell takes the node's whole cell. With
several, the spouse band is split: each boundary goes halfway between the
children of the two unions it separates (a childless union gives way to its
neighbours' children), then a pass each way makes every spouse cell at least
as wide as its name.

## Lines (cards style)

From every union with children, one line runs to **each** child: from the
middle of the outer edge of its spouse's card (the blood-line card when there
is no spouse; the core's edge at the root; beside a spouse, the seam between
the partners' cards) to the middle of the child's inner edge. `LINK_ROOM`
(26 px) is kept between rings for the lines.

A line is drawn in track coordinates — distance growing evenly, `u` eased by
a smootherstep (6t⁵ − 15t⁴ + 10t³) — so it leaves and arrives along the
normals and bends along the rings; unlike a smoothstep, its bending also comes
to rest at both ends, so it runs into the cards without a visible kink. A card
standing in a row starts and ends its lines on the row's straight edge, the
offset from the ring faded in along the line.

That shape is what makes lines of one generation band **never cross**, at any
compactness: all of them run between the same two distances, parents are in
order round the ring and so are children, and for two lines from `pA < pB`
to `cA < cB` the difference `(pB − pA)(1 − s) + (cB − cA)s` stays positive
all the way. A squeezed ring may slide a parent away from its children; its
lines then simply bend further. (Checked by a script on the bundled sample and
three real trees, circle, stadium and half-fan, compactness 0 / 0.5 / 1: zero
crossing pairs.)

Cards also stand further apart than the fan's cells: the cards style adds
`CARD_AIR` (8 px) to `cardSpacing`, which is tuned for tiles meant to touch.

## Core

A disc (or, for a partial opening, a sector; on a stadium, a pill) holding
the root family's spouses, one horizontal row each, centered on the sector's
centroid (`2r·sin α / 3α` above the center for an opening of 2α). Its base
radius fits the root names; the growth above may enlarge it.

## Branches

The first generation with three or more people (else the first with two)
defines the **branches**: each of its members and all their descendants share
one index, which the renderer turns into a hue (`colorMode: 'branch'`).
Generations above it are the trunk.

## Result

```ts
interface Layout {
  track: Track;                  // { half, ref } — circle when half = 0
  span: { start; end };          // the opening, in u
  core: Core;                    // root spouses, radius, center of the rows
  rings: Ring[];                 // mode, inner/split/outer, count
  cells: Cell[];                 // person, role, u0/u1/d0/d1, orient, fontSize, room for text
  links: Link[];                 // cards style only: sampled points of each line
  bounds: { x; y; width; height };     // for fit-to-view and export
  branches: { count; depth };
}
```

Keys for D3 joins: a cell's key is `nodeId|personId` (a node id is the id of
the person's first union, or `single:@I5@` for someone without one); a line's
key is its child's node id.
