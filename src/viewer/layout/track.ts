export interface Point {
  x: number;
  y: number;
}

/**
 * The shape every generation ring follows: all points at distance `d` from the
 * spine, the segment [-half, half] on the x axis — a stadium (two half circles
 * joined by straight sides). `half = 0` makes it a circle, so the round chart is
 * just the special case.
 *
 * A stadium, unlike an ellipse, keeps the same shape when offset: every ring is
 * again a stadium around the same spine, so the gap between two rings is the
 * same all the way round, and all rings share their normals.
 *
 * Positions are addressed by *piece* and fraction within it. The pieces, in
 * order (angles as in SVG: y down, so increasing angle runs clockwise):
 *   0  left end, upper quarter   — arc around (-half, 0), angle −π … −π/2
 *   1  top side                  — x from −half to half, y = −d
 *   2  right end                 — arc around (half, 0), angle −π/2 … π/2
 *   3  bottom side               — x from half to −half, y = d
 *   4  left end, lower quarter   — arc around (-half, 0), angle π/2 … π
 * The same (piece, fraction) lies on the same normal on every ring.
 *
 * The layout works in (u, d): `u` is the position along the rings — arc length
 * along the reference ring `ref` as a fraction of its perimeter, so u = 0 is the
 * leftmost point, 0.25 the top, 0.75 the bottom — and `d` the distance from the
 * spine. `u` may run outside [0, 1); it wraps.
 */
export interface Track {
  /** Half the length of the straight sides; 0 for a circle. */
  half: number;
  /**
   * Distance whose ring defines the shared coordinate `u`. Only weighs the ends
   * against the sides; any positive value gives a valid coordinate.
   */
  ref: number;
}

export interface TrackSpot {
  piece: number;
  /** Position within the piece, 0…1. */
  f: number;
}

const PIECES = 5;
const CAPS: Record<number, { cx: 1 | -1; from: number; sweep: number }> = {
  0: { cx: -1, from: -Math.PI, sweep: Math.PI / 2 },
  2: { cx: 1, from: -Math.PI / 2, sweep: Math.PI },
  4: { cx: -1, from: Math.PI / 2, sweep: Math.PI / 2 }
};

function pieceLength(track: Track, piece: number, d: number): number {
  const cap = CAPS[piece];
  return cap ? cap.sweep * Math.max(d, 0) : 2 * track.half;
}

/** Length of the ring at distance `d`. */
export function perimeter(track: Track, d: number): number {
  return 2 * Math.PI * Math.max(d, 0) + 4 * track.half;
}

/** Arc length along the ring at `d` → piece and fraction. `s` wraps around. */
function spotAt(track: Track, s: number, d: number): TrackSpot {
  const total = perimeter(track, d);
  if (total <= 0) return { piece: 0, f: 0 };
  let rest = ((s % total) + total) % total;
  for (let piece = 0; piece < PIECES; piece += 1) {
    const length = pieceLength(track, piece, d);
    if (rest < length || piece === PIECES - 1) {
      return { piece, f: length > 0 ? Math.min(rest / length, 1) : 0 };
    }
    rest -= length;
  }
  return { piece: 0, f: 0 };
}

/** Piece and fraction → arc length along the ring at `d`. */
function arcAt(track: Track, spot: TrackSpot, d: number): number {
  let s = 0;
  for (let piece = 0; piece < spot.piece; piece += 1) s += pieceLength(track, piece, d);
  return s + spot.f * pieceLength(track, spot.piece, d);
}

/** Shared coordinate u (any real; wraps) → piece and fraction. */
function spotOfU(track: Track, u: number): TrackSpot {
  const wrapped = u - Math.floor(u);
  return spotAt(track, wrapped * perimeter(track, track.ref), track.ref);
}

/** The point at (u, d), and the direction of the outward normal there (radians). */
export function locate(track: Track, u: number, d: number): { point: Point; normal: number } {
  const spot = spotOfU(track, u);
  const cap = CAPS[spot.piece];
  if (cap) {
    const angle = cap.from + spot.f * cap.sweep;
    return {
      point: { x: cap.cx * track.half + Math.cos(angle) * d, y: Math.sin(angle) * d },
      normal: angle
    };
  }
  if (spot.piece === 1) {
    return { point: { x: -track.half + spot.f * 2 * track.half, y: -d }, normal: -Math.PI / 2 };
  }
  return { point: { x: track.half - spot.f * 2 * track.half, y: d }, normal: Math.PI / 2 };
}

export function pointAt(track: Track, u: number, d: number): Point {
  return locate(track, u, d).point;
}

/** Arc length along the ring at `d` from u0 to u1 (u1 ≥ u0; may span several turns). */
export function arcLength(track: Track, u0: number, u1: number, d: number): number {
  const along = (u: number) =>
    Math.floor(u) * perimeter(track, d) + arcAt(track, spotOfU(track, u), d);
  return Math.max(along(u1) - along(u0), 0);
}

/**
 * The widest stretch of u that an arc of length `arc` at distance `rho` may
 * need anywhere round the ring. Round the ends an arc shrinks with distance
 * (u ∝ arc · ref / rho), along the sides it doesn't, so for rho ≤ ref the ends
 * are the worst case; on a circle this is exactly arc / (2π·rho).
 */
export function uForArc(track: Track, arc: number, rho: number): number {
  const r = Math.max(rho, 1e-6);
  return (arc * Math.max(track.ref / r, 1)) / perimeter(track, track.ref);
}

/**
 * Points along the ring at `d` from u0 to u1, close enough together that a
 * polyline through them follows the curve (the straight sides need only their
 * ends, but uniform steps keep it simple).
 */
export function sampleArc(track: Track, u0: number, u1: number, d: number, step = 6): Point[] {
  const length = arcLength(track, u0, u1, d);
  const count = Math.max(Math.ceil(length / step), 1);
  const points: Point[] = [];
  for (let i = 0; i <= count; i += 1) points.push(pointAt(track, u0 + ((u1 - u0) * i) / count, d));
  return points;
}

const fmt = (value: number) => (Math.round(value * 100) / 100).toString();
const pathOf = (points: Point[], close: boolean) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('') + (close ? 'Z' : '');

/**
 * SVG path of the band between distances d0 and d1 over [u0, u1] — a cell. A
 * band all the way round is an annulus (two closed loops; draw it with
 * fill-rule evenodd). On a circle the arcs are true SVG arcs.
 */
export function bandPath(track: Track, u0: number, u1: number, d0: number, d1: number): string {
  const full = u1 - u0 >= 1 - 1e-9;
  if (track.half === 0) {
    if (full) {
      const ring = (r: number) =>
        r > 0 ? `M${fmt(-r)} 0A${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(r)} 0A${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(-r)} 0Z` : '';
      return ring(d1) + ring(d0);
    }
    const a = pointAt(track, u0, d1);
    const b = pointAt(track, u1, d1);
    const c = pointAt(track, u1, d0);
    const e = pointAt(track, u0, d0);
    const large = u1 - u0 > 0.5 ? 1 : 0;
    const inner = d0 > 0 ? `A${fmt(d0)} ${fmt(d0)} 0 ${large} 0 ${fmt(e.x)} ${fmt(e.y)}` : '';
    return (
      `M${fmt(a.x)} ${fmt(a.y)}A${fmt(d1)} ${fmt(d1)} 0 ${large} 1 ${fmt(b.x)} ${fmt(b.y)}` +
      `L${fmt(c.x)} ${fmt(c.y)}${inner}Z`
    );
  }
  if (full) {
    const loop = (d: number) => pathOf(sampleArc(track, u0, u0 + 1, d).slice(0, -1), true);
    return loop(d1) + (d0 > 0 || track.half > 0 ? loop(Math.max(d0, 0)) : '');
  }
  const outer = sampleArc(track, u0, u1, d1);
  const inner = sampleArc(track, u0, u1, d0).reverse();
  return pathOf([...outer, ...inner], true);
}

/** SVG path of the line along the ring at `d` from u0 to u1 — text runs on it. */
export function arcLinePath(track: Track, u0: number, u1: number, d: number): string {
  if (track.half === 0 && u1 - u0 < 1 - 1e-9) {
    const a = pointAt(track, u0, d);
    const b = pointAt(track, u1, d);
    const sweep = u1 > u0 ? 1 : 0;
    const large = Math.abs(u1 - u0) > 0.5 ? 1 : 0;
    return `M${fmt(a.x)} ${fmt(a.y)}A${fmt(d)} ${fmt(d)} 0 ${large} ${sweep} ${fmt(b.x)} ${fmt(b.y)}`;
  }
  // sampleArc wants u0 < u1; walk it backwards for a reversed line.
  const points = u1 >= u0 ? sampleArc(track, u0, u1, d, 4) : sampleArc(track, u1, u0, d, 4).reverse();
  return pathOf(points, false);
}

/** SVG path of the whole ring at distance `d` (a circle when `half` is 0). */
export function trackPath(track: Track, d: number): string {
  const { half } = track;
  if (half <= 0) {
    return `M ${-d} 0 A ${d} ${d} 0 1 1 ${d} 0 A ${d} ${d} 0 1 1 ${-d} 0 Z`;
  }
  return (
    `M ${-half} ${-d} L ${half} ${-d} A ${d} ${d} 0 0 1 ${half} ${d} ` +
    `L ${-half} ${d} A ${d} ${d} 0 0 1 ${-half} ${-d} Z`
  );
}

/** SVG path of a polyline. */
export function polylinePath(points: Point[]): string {
  return pathOf(points, false);
}

/**
 * A point of a straight row of cards (cards style): the cards of one node on
 * one band stand side by side on the normal through the row's middle, so they
 * stay flush — each on its own normal they would part like fingers. `u` picks
 * the position across the row, as far from its start as the arc from `row.u0`
 * to `u` is long at distance `base` (the row's inner edge); `d` the distance
 * along the normal.
 */
export function rowPoint(track: Track, row: { u0: number; u1: number }, base: number, u: number, d: number): Point {
  const mid = (row.u0 + row.u1) / 2;
  const { point, normal } = locate(track, mid, d);
  const across =
    (u >= row.u0 ? arcLength(track, row.u0, u, base) : -arcLength(track, u, row.u0, base)) -
    arcLength(track, row.u0, row.u1, base) / 2;
  return { x: point.x - Math.sin(normal) * across, y: point.y + Math.cos(normal) * across };
}
