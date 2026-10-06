import type { DescendantTree, PersonRef, TreeNode } from '../tree/build.ts';
import type { Settings } from '../settings.ts';
import { arcLength, pointAt, rowPoint, sampleArc, uForArc, type Point, type Track } from './track.ts';

/**
 * Width of `text` in px at this font size. The browser measures on a canvas;
 * Node (tests) falls back to `approximateMeasure`. Injected so the layout stays
 * DOM-free.
 */
export type Measure = (text: string, fontSize: number, bold: boolean) => number;

export const approximateMeasure: Measure = (text, size, bold) => text.length * size * (bold ? 0.58 : 0.53);

/**
 * How a ring writes its names: `arc` — along the ring, so the ring is one or
 * two text lines thick (sparse inner generations); `radial` — across it, so the
 * ring is a name long but each cell only a line wide (dense outer ones).
 */
export type RingMode = 'arc' | 'radial';

export interface Ring {
  /** 1 = the first ring outside the core. */
  depth: number;
  mode: RingMode;
  /** Distance of the ring's inner edge from the spine. */
  inner: number;
  /** Where the blood-line band ends and the spouse band begins; null when the ring has no spouses. */
  split: number | null;
  outer: number;
  /** People-with-their-unions on the ring. */
  count: number;
}

export interface Cell {
  /** Unique and stable: node id + person id. */
  key: string;
  person: PersonRef;
  /** `blood`: the descendant; `spouse`: married into the line. */
  role: 'blood' | 'spouse';
  nodeId: string;
  /** Union to re-root the chart on when the cell is clicked; null for a childless, unmarried leaf. */
  familyId: string | null;
  depth: number;
  /** Main branch the cell belongs to (for colors); −1 above the first branching. */
  branch: number;
  /** The drawn shape: the band [d0, d1] over [u0, u1] of the track. */
  u0: number;
  u1: number;
  d0: number;
  d1: number;
  /** A cell running all the way round (a lone generation): drawn as an annulus. */
  full: boolean;
  /** Text direction: along the ring or across it. */
  orient: 'arc' | 'radial';
  fontSize: number;
  /** Room for text, px: along its direction and across it (padding already taken off). */
  along: number;
  across: number;
  /**
   * Cards style, written across the ring: the row of cards of its node on its
   * band. They are drawn as rectangles on the row's middle normal, flush with
   * each other (see `rowPoint`); null otherwise.
   */
  row: { u0: number; u1: number } | null;
}

/** A line of the cards style: parent → child, bent along the rings. Keyed by the child. */
export interface Link {
  key: string;
  /** Node ids of both ends, for highlighting. */
  parentId: string;
  childId: string;
  points: Point[];
}

export interface Core {
  /** The root family's spouses, one text row each. */
  people: PersonRef[];
  radius: number;
  /** Where the rows are centered: the centroid of the core's disc or sector. */
  center: Point;
  familyId: string;
}

export interface Layout {
  track: Track;
  /** The chart's opening along the track: u ∈ [start, end]. */
  span: { start: number; end: number };
  core: Core;
  rings: Ring[];
  cells: Cell[];
  links: Link[];
  /** Bounding box of the drawing, for fit-to-view and export. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Main branches (for colors), and the ring they start on (0 when there are none). */
  branches: { count: number; depth: number };
}

/** Radial room (px) the cards style keeps between rings for its lines. */
const LINK_ROOM = 26;
/**
 * Extra arc length (px) between neighbouring cards in the cards style, on top
 * of `cardSpacing`. The fan's cells are tiles meant to touch (3 px apart by
 * default); cards that close read as one strip rather than separate people.
 */
const CARD_AIR = 8;
/** Largest factor an arc ring's font may grow by when its cells are roomy. */
const MAX_FONT_SCALE = 2.2;
/** An arc ring is kept while it grows the chart by no more than this share. */
const ARC_TOLERANCE = 0.04;

/** Years of life, locale-neutral: «1890–1960», «*1890», «†1960». */
/** The name as drawn on the chart: with or without the surname. */
export function shownName(person: PersonRef, settings: Pick<Settings, 'givenNamesOnly'>): string {
  return settings.givenNamesOnly ? person.givenName : person.name;
}

export function yearsLabel(person: PersonRef): string | null {
  const { birthYear: b, deathYear: d } = person;
  if (b !== null && d !== null) return `${b}–${d}`;
  if (b !== null) return `*${b}`;
  if (d !== null) return `†${d}`;
  return null;
}

/** One union of a placed node: its spouse cell and the children it produced. */
interface Group {
  familyId: string;
  spouse: PersonRef | null;
  kids: Place[];
  /** Width (u) the spouse cell needs; 0 without one. */
  own: number;
  /** Center of the spouse cell (u, before scaling). */
  x: number;
}

/** A tree node on the chart. */
interface Place {
  node: TreeNode;
  depth: number;
  parent: Place | null;
  /** The parent's union this node descends from; null for the root. */
  group: Group | null;
  groups: Group[];
  kids: Place[];
  /** Width (u) the blood-line cell needs on its own. */
  bloodOwn: number;
  /** Width (u) the node needs on its ring: its own cell, or its spouse cells side by side. */
  own: number;
  /** Center relative to the parent's center (u, before scaling). */
  x: number;
  /** Absolute center (u, before scaling). */
  X: number;
  branch: number;
}

/** Left and right edge of a subtree on each ring below its root (index 0 = its own ring). */
interface Contour {
  left: number[];
  right: number[];
}

interface Metrics {
  font: number;
  lineH: number;
  yearsH: number;
  padX: number;
  padY: number;
  /** Widest text line of a person: the name, or the years if shown and wider. */
  textW: (p: PersonRef) => number;
  nameW: (p: PersonRef) => number;
}

function metricsFor(settings: Settings, measure: Measure): Metrics {
  const font = settings.fontSize;
  const bold = settings.boldFont;
  const yearsFont = font * 0.78;
  const widths = new Map<string, number>();
  const names = new Map<string, number>();
  const nameW = (p: PersonRef) => {
    let w = names.get(p.id);
    if (w === undefined) names.set(p.id, (w = measure(shownName(p, settings), font, bold)));
    return w;
  };
  const textW = (p: PersonRef) => {
    let w = widths.get(p.id);
    if (w === undefined) {
      const label = settings.showYears ? yearsLabel(p) : null;
      w = Math.max(nameW(p), label ? measure(label, yearsFont, false) : 0);
      widths.set(p.id, w);
    }
    return w;
  };
  return {
    font,
    lineH: font * 1.25,
    yearsH: yearsFont * 1.2,
    padX: Math.max(4, font * 0.5),
    padY: Math.max(2, font * 0.3),
    textW,
    nameW
  };
}

function buildPlaces(tree: DescendantTree, settings: Settings) {
  const byDepth: Place[][] = [];
  const make = (node: TreeNode, depth: number, parent: Place | null): Place => {
    const place: Place = {
      node,
      depth,
      parent,
      group: null,
      groups: [],
      kids: [],
      bloodOwn: 0,
      own: 0,
      x: 0,
      X: 0,
      branch: -1
    };
    (byDepth[depth] ??= []).push(place);
    for (const marriage of node.marriages) {
      const spouse =
        depth > 0 && settings.showBothSpouses && marriage.spouseId
          ? (node.spouses.find((p) => p.id === marriage.spouseId) ?? null)
          : null;
      place.groups.push({ familyId: marriage.familyId, spouse, kids: [], own: 0, x: 0 });
    }
    for (const child of node.children) {
      const kid = make(child, depth + 1, place);
      let group = place.groups.find((g) => g.familyId === child.parentFamilyId) ?? place.groups[0];
      if (!group) {
        group = { familyId: child.parentFamilyId ?? node.id, spouse: null, kids: [], own: 0, x: 0 };
        place.groups.push(group);
      }
      group.kids.push(kid);
      kid.group = group;
    }
    // Children in union order, so each union's children stay together.
    place.kids = place.groups.flatMap((g) => g.kids);
    return place;
  };
  const root = make(tree.root, 0, null);
  // Rings in the order the packing sees them: children in union order.
  byDepth.forEach((ring) => (ring.length = 0));
  const collect = (place: Place) => {
    byDepth[place.depth]!.push(place);
    place.kids.forEach(collect);
  };
  collect(root);
  return { root, byDepth };
}

/**
 * Moves the centers of one ring's cells as little as possible (least squares)
 * from `ideal`, keeping their order, so that neighbours i, i+1 end up at least
 * `dist[i]` apart. On a full circle (`wrap` set: the distance between the last
 * and the first, across the seam) positions are taken modulo 1; otherwise the
 * first center stays ≥ `lo` and the last ≤ `hi`.
 *
 * With cumulative offsets c (c₀ = 0, cᵢ₊₁ = cᵢ + distᵢ) the positions are
 * xᵢ = yᵢ + cᵢ and the spacing constraints become "y is non-decreasing" — an
 * isotonic regression of idealᵢ − cᵢ, solved by pool-adjacent-violators. The
 * bounds (or, on a circle, y_last − y_first ≤ slack) then clip that solution;
 * on a circle the best clipping window is found by ternary search (the cost
 * is convex in it).
 */
export function spreadRing(ideal: number[], dist: number[], wrap: number | null, lo: number, hi: number): number[] {
  const n = ideal.length;
  if (n === 0) return [];
  const c = [0];
  for (let i = 1; i < n; i += 1) c.push(c[i - 1]! + dist[i - 1]!);
  const z = ideal.map((v, i) => v - c[i]!);

  const sums: number[] = [];
  const counts: number[] = [];
  const mean = (run: number) => sums[run]! / counts[run]!;
  for (const value of z) {
    sums.push(value);
    counts.push(1);
    while (sums.length > 1 && mean(sums.length - 2) > mean(sums.length - 1)) {
      const sum = sums.pop()!;
      const count = counts.pop()!;
      sums[sums.length - 1]! += sum;
      counts[counts.length - 1]! += count;
    }
  }
  const fit: number[] = [];
  sums.forEach((_, run) => {
    for (let k = 0; k < counts[run]!; k += 1) fit.push(mean(run));
  });

  const clip = (a: number, b: number) => fit.map((v) => Math.min(Math.max(v, a), Math.max(b, a)));
  let y: number[];
  if (wrap === null) {
    y = clip(lo, hi - c[n - 1]!);
  } else {
    const slack = Math.max(1 - c[n - 1]! - wrap, 0);
    if (fit[n - 1]! - fit[0]! <= slack) y = fit;
    else {
      const cost = (a: number) => clip(a, a + slack).reduce((sum, v, k) => sum + (v - z[k]!) ** 2, 0);
      let a = fit[0]!;
      let b = fit[n - 1]! - slack;
      for (let i = 0; i < 80; i += 1) {
        const m1 = a + (b - a) / 3;
        const m2 = b - (b - a) / 3;
        if (cost(m1) <= cost(m2)) b = m2;
        else a = m1;
      }
      const at = (a + b) / 2;
      y = clip(at, at + slack);
    }
  }
  return y.map((v, i) => v + c[i]!);
}

/** Geometry of every ring for one choice of modes and core growth. */
interface Radii {
  core: number;
  inner: number[];
  split: (number | null)[];
  outer: number[];
}

/**
 * Lays out the descendant tree as rings of generations round a core holding the
 * root family. Subtrees are packed side by side as tightly as their outlines
 * allow on every ring (a radial tidy tree), each parent centered over its
 * children. See docs/layout.md.
 */
export function computeLayout(tree: DescendantTree, settings: Settings, measure: Measure = approximateMeasure): Layout {
  const m = metricsFor(settings, measure);
  const { root, byDepth } = buildPlaces(tree, settings);
  const K = byDepth.length - 1;
  const cards = settings.chartStyle === 'cards';
  /** Spouses stand beside their partner on the ring rather than in a band outside. */
  const beside = settings.spousesBeside;
  const spanU = Math.min(Math.max(settings.fanAngle, 90), 360) / 360;
  const fullCircle = spanU > 1 - 1e-9;
  const start = fullCircle ? -0.25 : 0.25 - spanU / 2;
  const top = 0.25;

  // ---- What each ring holds ----------------------------------------------------
  const ringHasSpouse: boolean[] = [false];
  const ringHasYears: boolean[] = [false];
  for (let k = 1; k <= K; k += 1) {
    const places = byDepth[k]!;
    ringHasSpouse.push(places.some((p) => p.groups.some((g) => g.spouse)));
    ringHasYears.push(
      settings.showYears &&
        places.some((p) => yearsLabel(p.node.spouses[0]!) || p.groups.some((g) => g.spouse && yearsLabel(g.spouse)))
    );
  }
  const bloodPeople = (k: number) => byDepth[k]!.map((p) => p.node.spouses[0]!);
  const spousePeople = (k: number) =>
    byDepth[k]!.flatMap((p) => p.groups.map((g) => g.spouse).filter((s): s is PersonRef => s !== null));

  const arcBand = (k: number) => m.lineH + (ringHasYears[k] ? m.yearsH : 0) + 2 * m.padY;
  const radialBand = (people: PersonRef[]) =>
    Math.min(Math.max(...people.map(m.textW), 0) + 2 * m.padX, Math.max(settings.cardLength, m.lineH * 2));
  /** Radial thickness of the blood-line and spouse bands of ring k. */
  const bandCache = new Map<string, [number, number]>();
  const bands = (k: number, mode: RingMode): [number, number] => {
    // Pure in (ring, mode) and asked for on every trial radius: measure once.
    const key = `${k}|${mode}`;
    let cached = bandCache.get(key);
    if (!cached) bandCache.set(key, (cached = measureBands(k, mode)));
    return cached;
  };
  const measureBands = (k: number, mode: RingMode): [number, number] => {
    if (beside) return [mode === 'arc' ? arcBand(k) : radialBand([...bloodPeople(k), ...spousePeople(k)]), 0];
    if (mode === 'arc') return [arcBand(k), ringHasSpouse[k] ? arcBand(k) : 0];
    return [radialBand(bloodPeople(k)), ringHasSpouse[k] ? radialBand(spousePeople(k)) : 0];
  };
  /** Where a spouse cell runs radially: the outer band, or the whole ring when beside. */
  const spouseBand = (radii: { inner: number[]; split: (number | null)[]; outer: number[] }, k: number): [number, number] =>
    beside ? [radii.inner[k]!, radii.outer[k]!] : [radii.split[k]!, radii.outer[k]!];
  /** Where a descendant's cell ends radially: before the spouse band, if there is one for them. */
  const bloodTo = (radii: { split: (number | null)[]; outer: number[] }, k: number, place: Place) =>
    !beside && place.groups.some((g) => g.spouse) ? radii.split[k]! : radii.outer[k]!;
  /** Least tangential width (px) of a cell written across the ring. */
  const radialWidth = Math.max(settings.cardThickness, m.lineH + 2);
  const gapBefore = settings.ringGap + (cards ? LINK_ROOM : 0);

  const coreFont = m.font * 1.3;
  const coreRows = Math.max(tree.root.spouses.length, 1);
  const widestRoot = Math.max(...tree.root.spouses.map((p) => measure(shownName(p, settings), coreFont, true)), 0);
  const baseCore = fullCircle
    ? Math.max(30, widestRoot / 2 + 14, (coreRows * coreFont * 1.3) / 1.6 + 8)
    : Math.max(36, widestRoot / 2 + 18, coreRows * coreFont * 1.4 + 12);

  /**
   * Ring distances: the core grown by `grow`, and each ring k given `extra[k]`
   * more room — as thickness in the fan style (its bands grow in proportion),
   * as a wider gap before it in the cards style (where the lines run).
   */
  const radiiFor = (modes: RingMode[], grow: number, extra: number[] = []): Radii => {
    const radii: Radii = { core: baseCore + grow, inner: [0], split: [null], outer: [0] };
    let d = radii.core;
    for (let k = 1; k <= K; k += 1) {
      const more = extra[k] ?? 0;
      d += gapBefore + (cards ? more : 0);
      const [blood, spouse] = bands(k, modes[k]!);
      const grown = cards ? 1 : 1 + more / Math.max(blood + spouse, 1);
      radii.inner.push(d);
      radii.split.push(spouse > 0 ? d + blood * grown : null);
      d += (blood + spouse) * grown;
      radii.outer.push(d);
    }
    return radii;
  };

  const trackFor = (radii: Radii): Track => {
    const outer = radii.outer[K] ?? radii.core;
    return { half: Math.max(settings.shapeStretch - 1, 0) * outer, ref: Math.max(radii.inner[K] ?? outer, 1) };
  };

  /** A cell's least width (px) and the distance it is measured at. */
  const ownArc = (person: PersonRef, mode: RingMode, from: number, to: number) =>
    mode === 'arc'
      ? { arc: m.textW(person) + 2 * m.padX, rho: (from + to) / 2 }
      : { arc: radialWidth, rho: from };

  /**
   * Sets every place's own widths (u) for these rings; returns the gap sizes
   * (u) per ring. Runs on every trial radius, so everything that depends on
   * the radii is worked out once per ring: `uForArc` is linear in the arc, so
   * a width is its arc (px, fixed per person) times the ring's factor.
   */
  const measureOwn = (modes: RingMode[], radii: Radii, track: Track) => {
    const perPx = (rho: number) => uForArc(track, 1, rho);
    const spU = [0];
    const famU = [0];
    for (let k = 1; k <= K; k += 1) {
      spU.push((settings.cardSpacing + (cards ? CARD_AIR : 0)) * perPx(radii.inner[k]!));
      famU.push(settings.familyGap * perPx(radii.inner[k]!));
    }
    const sp = (k: number) => spU[k] ?? 0;
    const fam = (k: number) => famU[k] ?? 0;
    for (let k = 1; k <= K; k += 1) {
      const mode = modes[k]!;
      const inner = radii.inner[k]!;
      const outer = radii.outer[k]!;
      const [spouseFrom, spouseTo] = spouseBand(radii, k);
      // Arc text is measured at the middle of its band, radial at the inner edge.
      const at = (from: number, to: number) => perPx(mode === 'arc' ? (from + to) / 2 : from);
      const bloodAlone = at(inner, outer);
      const bloodPaired = beside ? bloodAlone : at(inner, radii.split[k] ?? outer);
      const spouseF = ringHasSpouse[k] ? at(spouseFrom, spouseTo) : 0;
      const arcOf = (person: PersonRef) => (mode === 'arc' ? m.textW(person) + 2 * m.padX : radialWidth);
      for (const place of byDepth[k]!) {
        let spouses = 0;
        let count = 0;
        for (const group of place.groups) {
          group.own = group.spouse ? arcOf(group.spouse) * spouseF : 0;
          if (group.spouse) {
            spouses += group.own;
            count += 1;
          }
        }
        place.bloodOwn = arcOf(place.node.spouses[0]!) * (count > 0 ? bloodPaired : bloodAlone);
        // Beside: the cells stand shoulder to shoulder; else the spouses share
        // the outer band, `cardSpacing` apart, under the descendant's cell.
        place.own = beside
          ? place.bloodOwn + spouses
          : Math.max(place.bloodOwn, spouses + Math.max(count - 1, 0) * sp(k));
      }
    }
    /**
     * Gap between two neighbouring subtrees at ring `ring`: siblings keep the
     * card spacing, cousins (and children of different unions) the family gap too.
     */
    const gap = (ring: number, cousins: boolean) => (spU[ring] ?? 0) + (cousins ? (famU[ring] ?? 0) : 0);
    /** Gap between neighbours a, b on one ring. */
    const between = (a: Place, b: Place) => gap(a.depth, a.group !== b.group);
    return { sp, fam, gap, between };
  };

  /** True when every ring, on its own, holds its cells (with their gaps) in the opening. */
  const ringsFit = (modes: RingMode[], radii: Radii, track: Track) => {
    const { gap, between } = measureOwn(modes, radii, track);
    for (let k = 1; k <= K; k += 1) {
      const places = byDepth[k]!;
      let total = places.reduce((sum, p) => sum + p.own, 0);
      for (let i = 1; i < places.length; i += 1) total += between(places[i - 1]!, places[i]!);
      if (fullCircle && places.length > 1) total += gap(k, true);
      if (total > spanU * (1 + 1e-9)) return false;
    }
    return true;
  };

  // ---- Packing ------------------------------------------------------------------------
  /**
   * Packs the whole tree for these rings, in u before scaling: sets every
   * place's `own`, `x` and `X`, and returns how far the packing must be scaled
   * to fill the opening (< 1: it doesn't fit).
   */
  const pack = (modes: RingMode[], radii: Radii, track: Track) => {
    const { sp, fam, gap, between } = measureOwn(modes, radii, track);

    const packPlace = (place: Place): Contour => {
      const k = place.depth;
      const half = place.own / 2;
      const kids = place.kids;
      if (!kids.length) return { left: [-half], right: [half] };
      const contours = kids.map(packPlace);
      const gapAt = (a: Place, b: Place, d: number) => gap(k + 1 + d, d > 0 || a.group !== b.group);

      // Left to right: each subtree as close to the ones before as every ring allows.
      const lr: number[] = [0];
      let accL = contours[0]!.left.slice();
      let accR = contours[0]!.right.slice();
      for (let j = 1; j < kids.length; j += 1) {
        const c = contours[j]!;
        let shift = -Infinity;
        for (let d = 0; d < Math.min(c.left.length, accR.length); d += 1) {
          shift = Math.max(shift, accR[d]! + gapAt(kids[j - 1]!, kids[j]!, d) - c.left[d]!);
        }
        lr.push(shift);
        for (let d = 0; d < c.left.length; d += 1) {
          accR[d] = shift + c.right[d]!;
          if (d >= accL.length) accL[d] = shift + c.left[d]!;
        }
      }
      // Right to left, the mirror image. A lone small subtree between two big
      // ones would stick to whichever side the pass starts from; the average of
      // both packings sits in the middle, and — the no-overlap conditions being
      // linear in the offsets — is overlap-free as well.
      const n = kids.length;
      const rl: number[] = new Array<number>(n).fill(0);
      accL = contours[n - 1]!.left.slice();
      accR = contours[n - 1]!.right.slice();
      for (let j = n - 2; j >= 0; j -= 1) {
        const c = contours[j]!;
        let shift = Infinity;
        for (let d = 0; d < Math.min(c.right.length, accL.length); d += 1) {
          shift = Math.min(shift, accL[d]! - gapAt(kids[j]!, kids[j + 1]!, d) - c.right[d]!);
        }
        rl[j] = shift;
        for (let d = 0; d < c.right.length; d += 1) {
          accL[d] = shift + c.left[d]!;
          if (d >= accR.length) accR[d] = shift + c.right[d]!;
        }
      }
      const lrMid = (lr[0]! + lr[n - 1]!) / 2;
      const rlMid = (rl[0]! + rl[n - 1]!) / 2;
      kids.forEach((kid, j) => {
        kid.x = (lr[j]! - lrMid + rl[j]! - rlMid) / 2;
      });

      const left: number[] = [-half];
      const right: number[] = [half];
      kids.forEach((kid, j) => {
        const c = contours[j]!;
        for (let d = 0; d < c.left.length; d += 1) {
          left[d + 1] = Math.min(left[d + 1] ?? Infinity, kid.x + c.left[d]!);
          right[d + 1] = Math.max(right[d + 1] ?? -Infinity, kid.x + c.right[d]!);
        }
      });
      return { left, right };
    };

    const contour = packPlace(root);
    const place = (p: Place, X: number) => {
      p.X = X;
      p.kids.forEach((kid) => place(kid, X + kid.x));
    };
    place(root, 0);

    // How far the packing must be stretched (or may be, when < 1 it doesn't fit)
    // to fill the opening. A full circle closes on itself, so on every ring with
    // two or more cells the first and last need a gap across the seam.
    let scale = Infinity;
    let low = Infinity;
    let high = -Infinity;
    for (let d = 1; d <= K; d += 1) {
      const extent = contour.right[d]! - contour.left[d]!;
      if (fullCircle) {
        const seam = byDepth[d]!.length > 1 ? gap(d, true) : 0;
        scale = Math.min(scale, (1 - seam) / Math.max(extent, 1e-12));
      }
      low = Math.min(low, contour.left[d]!);
      high = Math.max(high, contour.right[d]!);
    }
    if (!fullCircle) scale = spanU / Math.max(high - low, 1e-12);
    if (K === 0) scale = 1;
    return { scale, low, sp, fam, between };
  };

  /** Least core growth (bisected: the test only gets easier as the radius grows). */
  const leastGrowth = (fits: (grow: number) => boolean, guess = 0) => {
    if (fits(0)) return 0;
    // Bracket the answer — around a guess (the previous trial's answer, which
    // is usually close), else by doubling — then bisect. Every step packs the
    // whole tree, and a pixel of radius is invisible.
    let lo = 0;
    let hi = Math.max(baseCore, 64);
    if (guess > 0) {
      const step = Math.max(guess * 0.1, 8);
      if (fits(guess)) {
        hi = guess;
        lo = Math.max(guess - step, 0);
        while (lo > 0 && fits(lo)) {
          hi = lo;
          lo = Math.max(lo - step * 2, 0);
        }
      } else {
        lo = guess;
        hi = guess + step;
        while (!fits(hi) && hi < 1e7) {
          lo = hi;
          hi += step * 2;
        }
      }
    } else {
      while (!fits(hi) && hi < 1e7) hi *= 2;
    }
    for (let i = 0; i < 40 && hi - lo > 1; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  /**
   * How far out the rings go. Any ring could be pushed on its own, but pushing
   * the core moves them all out (relieving every one) for the same growth of
   * the chart, so the core is what grows. Two bounds: the tidy packing fits
   * unchanged (`tidy`), or each ring merely holds its own cells (`tight`, cells
   * then slide sideways); `compactness` picks a point between them.
   */
  let lastTidy = 0;
  let lastTight = 0;
  const solve = (modes: RingMode[]) => {
    const tidy = (lastTidy = leastGrowth((grow) => {
      const radii = radiiFor(modes, grow);
      return pack(modes, radii, trackFor(radii)).scale >= 1 - 1e-9;
    }, lastTidy));
    const tight = (lastTight = leastGrowth((grow) => {
      const radii = radiiFor(modes, grow);
      return ringsFit(modes, radii, trackFor(radii));
    }, lastTight));
    const c = Math.min(Math.max(settings.compactness, 0), 1);
    const grow = tight + (1 - c) * Math.max(tidy - tight, 0);
    const radii = radiiFor(modes, grow);
    return { grow, radii, outer: radii.outer[K] ?? radii.core };
  };

  /**
   * The growth all in the core leaves a large empty disc when the outer rings
   * are crowded and the inner ones sparse. Hand it out evenly to the core and
   * as many inner rings as can take it without the packing getting tighter
   * (moving room outwards brings the inner rings in): thicker inner bands,
   * larger names of the ancestors — or, for cards, longer lines.
   */
  const spreadGrowth = (modes: RingMode[], grow: number): Radii => {
    const plain = radiiFor(modes, grow);
    if (grow <= 1 || K < 2) return plain;
    const plainTrack = trackFor(plain);
    const baseScale = pack(modes, plain, plainTrack).scale;
    const baseFit = ringsFit(modes, plain, plainTrack);
    for (let j = K - 1; j >= 1; j -= 1) {
      const share = grow / (j + 1);
      const extra = Array.from({ length: K + 1 }, (_, k) => (k >= 1 && k <= j ? share : 0));
      const radii = radiiFor(modes, share, extra);
      const track = trackFor(radii);
      if (baseFit && !ringsFit(modes, radii, track)) continue;
      if (pack(modes, radii, track).scale >= baseScale * (1 - 0.005)) return radii;
    }
    return plain;
  };

  // ---- Ring modes -----------------------------------------------------------------
  let modes: RingMode[] = Array.from({ length: K + 1 }, () => 'radial' as RingMode);
  if (settings.arcRings >= 0) {
    modes = modes.map((_, k) => (k >= 1 && k <= settings.arcRings ? 'arc' : 'radial'));
  } else {
    // Inner rings, one by one, go along the arc while that keeps the chart about
    // as small: a sparse generation then takes a thin band instead of a wide
    // ring of mostly empty sectors. Judged by the tight bound (each ring on its
    // own), which needs no packing — the full solve would repeat the tree's
    // packing a hundred times per trial, on every slider step.
    const tightOuter = (trial: RingMode[]) => {
      const grow = leastGrowth((g) => {
        const radii = radiiFor(trial, g);
        return ringsFit(trial, radii, trackFor(radii));
      }, lastTight);
      lastTight = grow;
      return radiiFor(trial, grow).outer[K] ?? 0;
    };
    let best = tightOuter(modes);
    for (let k = 1; k <= K; k += 1) {
      const trial = modes.slice();
      trial[k] = 'arc';
      const outer = tightOuter(trial);
      if (outer > best * (1 + ARC_TOLERANCE) + 2) break;
      modes = trial;
      best = Math.min(best, outer);
    }
  }

  const radii = spreadGrowth(modes, solve(modes).grow);
  const track = trackFor(radii);
  const { scale, low, sp, between } = pack(modes, radii, track);
  const toU = (X: number) => (fullCircle ? top + X * scale : start + (X - low) * scale);
  /** Widths grow with a packing stretched to fill the opening, never shrink with a squeezed one. */
  const stretch = Math.max(scale, 1);

  // Final centers. A packing that fits is only stretched; a squeezed one (the
  // rings sit closer in than the tidy layout needs) is shrunk to fit, which
  // makes neighbours overlap, and every ring is then spread on its own — from
  // the outermost in, each parent aiming for the middle of its children as
  // they finally stand, so it stays over them (and, in the cards style, its
  // line doesn't cross a neighbour's).
  const center = new Map<Place, number>();
  for (let k = K; k >= 1; k -= 1) {
    const places = byDepth[k]!;
    if (scale >= 1 - 1e-9) {
      places.forEach((p) => center.set(p, toU(p.X)));
      continue;
    }
    const ideal = places.map((p) =>
      p.kids.length ? (center.get(p.kids[0]!)! + center.get(p.kids[p.kids.length - 1]!)!) / 2 : toU(p.X)
    );
    const dist = places.slice(1).map((p, i) => places[i]!.own / 2 + between(places[i]!, p) + p.own / 2);
    const first = places[0]!;
    const last = places[places.length - 1]!;
    const wrap = fullCircle ? last.own / 2 + (places.length > 1 ? between(last, first) : 0) + first.own / 2 : null;
    const spread = spreadRing(ideal, dist, wrap, start + first.own / 2, start + spanU - last.own / 2);
    places.forEach((p, i) => center.set(p, spread[i]!));
  }
  const at = (p: Place) => center.get(p)!;
  /** A place's own interval, and a spouse cell's center, around the final center. */
  const ownExt = (p: Place) => ({ u0: at(p) - (p.own * stretch) / 2, u1: at(p) + (p.own * stretch) / 2 });
  const spouseAt = (p: Place, g: Group) => at(p) + (g.x - p.X) * stretch;

  // ---- Spouse cells inside their node --------------------------------------------------
  // Each spouse cell wants to sit over its own union's children; keep them in
  // order, `cardSpacing` apart, within the node's width.
  for (let k = 1; k <= K; k += 1) {
    for (const place of byDepth[k]!) {
      const withCells = place.groups.filter((g) => g.spouse);
      if (withCells.length === 0) continue;
      if (withCells.length === 1) {
        withCells[0]!.x = place.X;
        continue;
      }
      const lo = place.X - place.own / 2;
      const hi = place.X + place.own / 2;
      const ideal = withCells.map((g) =>
        g.kids.length ? (g.kids[0]!.X + g.kids[g.kids.length - 1]!.X) / 2 : Number.NaN
      );
      let cursor = lo;
      withCells.forEach((g, i) => {
        const want = Number.isNaN(ideal[i]!) ? cursor + g.own / 2 : ideal[i]!;
        g.x = Math.max(want, cursor + g.own / 2);
        cursor = g.x + g.own / 2 + sp(k);
      });
      cursor = hi;
      for (let i = withCells.length - 1; i >= 0; i -= 1) {
        const g = withCells[i]!;
        g.x = Math.min(g.x, cursor - g.own / 2);
        cursor = g.x - g.own / 2 - sp(k);
      }
    }
  }

  // ---- Branches -------------------------------------------------------------------
  // Branches start at the first generation of three or more (a split in two
  // alone colors the chart in halves), else at the first split at all.
  let branchDepth = byDepth.findIndex((places, k) => k > 0 && places.length > 2);
  if (branchDepth < 0) branchDepth = byDepth.findIndex((places, k) => k > 0 && places.length > 1);
  if (branchDepth > 0) {
    byDepth[branchDepth]!.forEach((place, i) => {
      const mark = (p: Place) => {
        p.branch = i;
        p.kids.forEach(mark);
      };
      mark(place);
    });
  }

  // ---- Cell extents ---------------------------------------------------------------------
  /**
   * The u-width, centered on u, that makes an arc of `arc` px at distance rho.
   * Exact even where a stadium's end meets its side (the arc per u changes
   * there), so bisect.
   */
  const uWidthAt = (u: number, arc: number, rho: number) => {
    let lo = 0;
    let hi = uForArc(track, arc, rho);
    while (arcLength(track, u - hi / 2, u + hi / 2, rho) < arc && hi < 1) hi *= 2;
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2;
      if (arcLength(track, u - mid / 2, u + mid / 2, rho) >= arc) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  interface Extent {
    u0: number;
    u1: number;
  }
  const bloodExt = new Map<Place, Extent>();
  const spouseExt = new Map<Group, Extent>();

  if (cards) {
    // A card of its own size at its place; a person married several times gets
    // a card reaching over all their spouses' cards.
    for (let k = 1; k <= K; k += 1) {
      const ring = { inner: radii.inner[k]!, split: radii.split[k], outer: radii.outer[k]! };
      for (const place of byDepth[k]!) {
        const card = (person: PersonRef, x: number, from: number, to: number): Extent => {
          const u = x;
          const { arc, rho } = ownArc(person, modes[k]!, from, to);
          const half = uWidthAt(u, arc, rho) / 2;
          return { u0: u - half, u1: u + half };
        };
        if (beside) {
          // Blood-line card first, then one per spouse, shoulder to shoulder,
          // the row centered on the node.
          const people = [place.node.spouses[0]!, ...place.groups.flatMap((g) => (g.spouse ? [g.spouse] : []))];
          const widths = people.map((person) => {
            const { arc, rho } = ownArc(person, modes[k]!, ring.inner, ring.outer);
            return uWidthAt(at(place), arc, rho);
          });
          let cursor = at(place) - widths.reduce((a, b) => a + b, 0) / 2;
          const exts = widths.map((w) => ({ u0: cursor, u1: (cursor += w) }));
          bloodExt.set(place, exts[0]!);
          let i = 1;
          for (const group of place.groups) if (group.spouse) spouseExt.set(group, exts[i++]!);
          continue;
        }
        const own = card(place.node.spouses[0]!, at(place), ring.inner, bloodTo(radii, k, place));
        for (const group of place.groups) {
          if (!group.spouse) continue;
          const ext = card(group.spouse, spouseAt(place, group), ...spouseBand(radii, k));
          spouseExt.set(group, ext);
          own.u0 = Math.min(own.u0, ext.u0);
          own.u1 = Math.max(own.u1, ext.u1);
        }
        bloodExt.set(place, own);
      }
    }
  } else {
    // Fan: a cell starts as its packed width (stretched with the rest) and then
    // widens to cover its children, as far as its neighbours leave room — from
    // the outermost ring in, so every parent sees its children's final cells.
    for (let k = K; k >= 1; k -= 1) {
      const places = byDepth[k]!;
      const gapK = sp(k) * stretch;
      const own = places.map(ownExt);
      const want = places.map((p, i) => {
        const ext = { ...own[i]! };
        for (const kid of p.kids) {
          const c = bloodExt.get(kid)!;
          ext.u0 = Math.min(ext.u0, c.u0);
          ext.u1 = Math.max(ext.u1, c.u1);
        }
        return ext;
      });
      const result = want.map((w) => ({ ...w }));
      const n = places.length;
      const pairs = fullCircle && n > 1 ? n : n - 1;
      for (let i = 0; i < pairs; i += 1) {
        const j = (i + 1) % n;
        const wrap = j === 0 ? 1 : 0;
        const aRight = want[i]!.u1;
        const bLeft = want[j]!.u0 + wrap;
        if (aRight + gapK <= bLeft) continue;
        const lo = own[i]!.u1;
        const hi = own[j]!.u0 + wrap - gapK;
        const b = Math.min(Math.max((aRight + bLeft - gapK) / 2, lo), Math.max(hi, lo));
        result[i]!.u1 = Math.min(result[i]!.u1, b);
        result[j]!.u0 = Math.max(result[j]!.u0, b + gapK - wrap);
      }
      if (!fullCircle) {
        // Nothing may leave the opening.
        result.forEach((r) => {
          r.u0 = Math.max(r.u0, start);
          r.u1 = Math.min(r.u1, start + spanU);
        });
      }
      places.forEach((p, i) => bloodExt.set(p, result[i]!));
    }

    // Second pass, from the core out: close the holes. A cell grows into the
    // free room beside it, up to halfway to its neighbour, but never past its
    // parent's cell — children fill their parent's sector, they don't spill.
    for (let k = 1; k <= K; k += 1) {
      const places = byDepth[k]!;
      const gapK = sp(k) * stretch;
      const n = places.length;
      if (n === 1 && fullCircle) continue;
      const exts = places.map((p) => bloodExt.get(p)!);
      const parentExt = (p: Place): Extent =>
        p.parent && p.parent.depth > 0
          ? bloodExt.get(p.parent)!
          : { u0: fullCircle ? -Infinity : start, u1: fullCircle ? Infinity : start + spanU };
      const pairs = fullCircle && n > 1 ? n : n - 1;
      for (let i = 0; i < pairs; i += 1) {
        const j = (i + 1) % n;
        const wrap = j === 0 ? 1 : 0;
        const a = exts[i]!;
        const b = exts[j]!;
        const bu0 = b.u0 + wrap;
        if (bu0 - a.u1 <= gapK) continue;
        const aMax = Math.min(parentExt(places[i]!).u1, bu0 - gapK);
        const bMin = Math.max(parentExt(places[j]!).u0 + wrap, a.u1 + gapK);
        const mid = (a.u1 + bu0) / 2;
        let aNew = Math.min(Math.max(mid - gapK / 2, a.u1), Math.max(aMax, a.u1));
        let bNew = Math.max(Math.min(mid + gapK / 2, bu0), Math.min(bMin, bu0));
        // One side capped by its parent: the other may take the rest.
        if (aNew < mid - gapK / 2) bNew = Math.max(Math.min(bNew, aNew + gapK), Math.min(bMin, bu0));
        if (bNew > mid + gapK / 2) aNew = Math.min(Math.max(aNew, bNew - gapK), Math.max(aMax, a.u1));
        a.u1 = aNew;
        b.u0 = bNew - wrap;
      }
      // The ends of a partial fan reach the edges of the opening (or their parent's).
      if (!fullCircle && n > 0) {
        exts[0]!.u0 = Math.min(exts[0]!.u0, Math.max(parentExt(places[0]!).u0, start));
        exts[n - 1]!.u1 = Math.max(exts[n - 1]!.u1, Math.min(parentExt(places[n - 1]!).u1, start + spanU));
      }
    }

    for (let k = 1; k <= K; k += 1) {
      const places = byDepth[k]!;
      const gapK = sp(k) * stretch;
      const lone = fullCircle && places.length === 1;
      // Spouse cells share their node's cell: one union takes it whole, several
      // split it, each widened towards its own children.
      for (const place of places) {
        // A lone generation's cell is the whole ring; its spouses split it,
        // leaving a gap where the last meets the first.
        const cell = lone ? { u0: start, u1: start + 1 - gapK } : bloodExt.get(place)!;
        const withCells = place.groups.filter((g) => g.spouse);
        if (beside && withCells.length) {
          // Side by side: the node's cell is shared in proportion to the
          // widths the names need, the descendant first.
          const owns = [place.bloodOwn, ...withCells.map((g) => g.own)];
          const total = owns.reduce((a, b) => a + b, 0);
          let cursor = cell.u0;
          const exts = owns.map((o) => ({ u0: cursor, u1: (cursor += ((cell.u1 - cell.u0) * o) / total) }));
          bloodExt.set(place, exts[0]!);
          withCells.forEach((g, i) => spouseExt.set(g, exts[i + 1]!));
          continue;
        }
        if (withCells.length === 1) {
          spouseExt.set(withCells[0]!, { ...cell });
          continue;
        }
        // Each boundary goes halfway between the children of the two unions it
        // separates; then a pass each way makes every cell at least as wide as
        // its spouse's name needs (the node's cell holds them all).
        const widths = withCells.map((g) => g.own);
        const wants = withCells.map((g) => {
          const center = spouseAt(place, g);
          const e = { u0: center, u1: center };
          for (const kid of g.kids) {
            const c = bloodExt.get(kid)!;
            e.u0 = Math.min(e.u0, c.u0);
            e.u1 = Math.max(e.u1, c.u1);
          }
          return e;
        });
        const n = withCells.length;
        // A childless union has nothing to cover: it gives way to its
        // neighbours' children and keeps just its own width.
        const bounds = wants.slice(1).map((w, i) => {
          const left = withCells[i]!.kids.length > 0;
          const right = withCells[i + 1]!.kids.length > 0;
          if (left && !right) return wants[i]!.u1;
          if (right && !left) return w.u0 - gapK;
          return (wants[i]!.u1 + w.u0 - gapK) / 2;
        });
        for (let i = 0; i < n - 1; i += 1) {
          const from = i === 0 ? cell.u0 : bounds[i - 1]! + gapK;
          bounds[i] = Math.max(bounds[i]!, from + widths[i]!);
        }
        for (let i = n - 2; i >= 0; i -= 1) {
          const to = i === n - 2 ? cell.u1 : bounds[i + 1]!;
          bounds[i] = Math.min(bounds[i]!, to - widths[i + 1]! - gapK);
        }
        const exts = withCells.map((_, i) => ({
          u0: i === 0 ? cell.u0 : bounds[i - 1]! + gapK,
          u1: i === n - 1 ? cell.u1 : bounds[i]!
        }));
        withCells.forEach((g, i) => spouseExt.set(g, exts[i]!));
      }
    }
  }

  // ---- Rings ------------------------------------------------------------------------
  const rings: Ring[] = [];
  for (let k = 1; k <= K; k += 1) {
    const inner = radii.inner[k]!;
    const outer = radii.outer[k]!;
    const splitAt = radii.split[k] ?? null;
    rings.push({ depth: k, mode: modes[k]!, inner, split: splitAt, outer, count: byDepth[k]!.length });
  }

  // ---- Cells --------------------------------------------------------------------------
  const cells: Cell[] = [];
  const bloodCell = new Map<Place, Cell>();
  const spouseCell = new Map<Group, Cell>();

  const makeCell = (
    place: Place,
    person: PersonRef,
    role: 'blood' | 'spouse',
    familyId: string | null,
    ext: Extent,
    d0: number,
    d1: number
  ): Cell => {
    const k = place.depth;
    const ring = rings[k - 1]!;
    // A generation of one runs all the way round — its spouse too, unless
    // several spouses share the ring between them.
    const full =
      !cards &&
      fullCircle &&
      byDepth[k]!.length === 1 &&
      (beside
        ? !place.groups.some((g) => g.spouse)
        : role === 'blood' || place.groups.filter((g) => g.spouse).length === 1);
    const u0 = full ? start : ext.u0;
    const u1 = full ? start + 1 : ext.u1;
    const years = settings.showYears && yearsLabel(person) ? m.yearsH : 0;
    const alongArc = arcLength(track, u0, u1, (d0 + d1) / 2) - 2 * m.padX;
    const acrossBand = d1 - d0 - 2 * m.padY;
    // Radial rings write across, unless a cell came out wide enough for its
    // name to run along the ring — the ancestors of large branches, mostly.
    const orient: 'arc' | 'radial' =
      ring.mode === 'arc' || (!cards && alongArc >= m.textW(person) && acrossBand >= m.lineH + years) ? 'arc' : 'radial';
    // A roomy cell writes its name larger, as far as it fits both ways (the
    // years keep their size).
    const grown =
      orient === 'arc' && !cards
        ? Math.max(Math.min(MAX_FONT_SCALE, alongArc / Math.max(m.nameW(person), 1), (acrossBand - years) / m.lineH), 1)
        : 1;
    const cell: Cell = {
      key: `${place.node.id}|${person.id}`,
      person,
      role,
      nodeId: place.node.id,
      familyId,
      depth: k,
      branch: place.branch,
      u0,
      u1,
      d0,
      d1,
      full,
      orient,
      fontSize: m.font * grown,
      along: orient === 'arc' ? alongArc : d1 - d0 - 2 * m.padX,
      across: orient === 'arc' ? acrossBand : arcLength(track, u0, u1, d0 + m.padX) - 2,
      row: null
    };
    cells.push(cell);
    return cell;
  };

  for (let k = 1; k <= K; k += 1) {
    const ring = rings[k - 1]!;
    for (const place of byDepth[k]!) {
      const firstUnion = place.node.kind === 'family' ? place.node.id : null;
      bloodCell.set(
        place,
        makeCell(
          place,
          place.node.spouses[0]!,
          'blood',
          firstUnion,
          bloodExt.get(place)!,
          ring.inner,
          bloodTo(radii, k, place)
        )
      );
      for (const group of place.groups) {
        const ext = spouseExt.get(group);
        if (!group.spouse || !ext) continue;
        spouseCell.set(group, makeCell(place, group.spouse, 'spouse', group.familyId, ext, ...spouseBand(radii, k)));
      }
    }
  }

  if (cards) {
    const rows = new Map<string, Cell[]>();
    for (const cell of cells) {
      if (cell.orient !== 'radial') continue;
      const key = `${cell.nodeId}|${cell.d0}`;
      rows.set(key, [...(rows.get(key) ?? []), cell]);
    }
    for (const row of rows.values()) {
      const extent = { u0: Math.min(...row.map((c) => c.u0)), u1: Math.max(...row.map((c) => c.u1)) };
      row.forEach((c) => (c.row = extent));
    }
  }

  // ---- Lines (cards style) -----------------------------------------------------------
  const links: Link[] = [];
  /**
   * A stem from (u0, d0) to (u1, d1): leaves and arrives along the normals,
   * bends along the rings (u eased, distance even). Sampled every couple of
   * pixels of its whole course, so the polyline reads as a smooth curve.
   * `start`, when given, is where the line really begins (a card's straight
   * edge, a little off the ring); the difference fades out along the way
   * instead of kinking the first step.
   */
  const stemPoints = (u0: number, d0: number, u1: number, d1: number, start?: Point): Point[] => {
    const travel = arcLength(track, Math.min(u0, u1), Math.max(u0, u1), (d0 + d1) / 2);
    const count = Math.min(Math.max(Math.ceil((travel + Math.abs(d1 - d0)) / 2), 12), 240);
    const first = pointAt(track, u0, d0);
    const shift = start ? { x: start.x - first.x, y: start.y - first.y } : { x: 0, y: 0 };
    const points: Point[] = [];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      // Smootherstep: not only the direction but also the bending comes to
      // rest at both ends, so the curve runs into the straight drop to a card
      // without a visible kink — smoothstep stops bending
      // abruptly there, and the eye reads that as a corner.
      const ease = t * t * t * (t * (6 * t - 15) + 10);
      const p = pointAt(track, u0 + (u1 - u0) * ease, d0 + (d1 - d0) * t);
      points.push({ x: p.x + shift.x * (1 - ease), y: p.y + shift.y * (1 - ease) });
    }
    return points;
  };
  if (cards) {
    const visit = (place: Place): void => {
      const k = place.depth;
      for (const group of place.groups) {
        if (!group.kids.length) continue;
        let from: { u: number; d: number };
        let start: Point | undefined;
        if (k === 0) {
          const first = bloodCell.get(group.kids[0]!)!;
          const last = bloodCell.get(group.kids[group.kids.length - 1]!)!;
          from = { u: ((first.u0 + first.u1) / 2 + (last.u0 + last.u1) / 2) / 2, d: radii.core };
        } else {
          const source = spouseCell.get(group) ?? bloodCell.get(place)!;
          // Beside, a union's lines leave from the seam between the spouse's
          // card and the one before it.
          const u = group.spouse ? (beside ? source.u0 : (source.u0 + source.u1) / 2) : at(place);
          from = { u, d: source.d1 };
          // A card standing in a row starts its lines on the row's straight edge.
          if (source.row) start = rowPoint(track, source.row, source.d0, u, from.d);
        }
        // One smooth line to every child — u eased, distance even — from the
        // parent into the middle of the child's own card. All lines of a band
        // run between the same two distances, and parents and children are
        // both in order round the ring, so at every distance the lines keep
        // that order: none of them cross, however far a squeezed ring slid a
        // parent.
        for (const kid of group.kids) {
          const target = bloodCell.get(kid)!;
          const to = target.row ? (target.u0 + target.u1) / 2 : at(kid);
          const points = stemPoints(from.u, from.d, to, target.d0, start);
          if (target.row) points[points.length - 1] = rowPoint(track, target.row, target.d0, to, target.d0);
          links.push({ key: kid.node.id, parentId: place.node.id, childId: kid.node.id, points });
        }
      }
      place.kids.forEach(visit);
    };
    visit(root);
  }

  // ---- Core and bounds ---------------------------------------------------------------
  const halfAngle = Math.PI * spanU;
  // Centroid of a circular sector opening upwards: 2r·sin α / 3α from the center.
  const centroidOffset = fullCircle ? 0 : (2 * radii.core * Math.sin(halfAngle)) / (3 * halfAngle);
  const core: Core = {
    people: tree.root.spouses,
    radius: radii.core,
    center: { x: 0, y: -centroidOffset },
    familyId: tree.root.id
  };

  const outerD = radii.outer[K] ?? radii.core;
  const edge = sampleArc(track, start, start + spanU, outerD, 12);
  if (!fullCircle) edge.push(pointAt(track, start, 0), pointAt(track, start + spanU, 0), { x: 0, y: 0 });
  const xs = edge.map((p) => p.x);
  const ys = edge.map((p) => p.y);
  const bounds = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };

  return {
    track,
    span: { start, end: start + spanU },
    core,
    rings,
    cells,
    links,
    bounds,
    branches: { count: branchDepth > 0 ? byDepth[branchDepth]!.length : 0, depth: Math.max(branchDepth, 0) }
  };
}
