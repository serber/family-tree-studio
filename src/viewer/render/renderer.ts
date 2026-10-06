import { select, zoom, zoomIdentity } from 'd3';
import type { Selection, ZoomBehavior } from 'd3';
import { shownName, yearsLabel, type Cell, type Layout, type Link, type Measure } from '../layout/fan.ts';
import { arcLinePath, bandPath, locate, pointAt, polylinePath, rowPoint, trackPath } from '../layout/track.ts';
import type { PersonRef } from '../tree/build.ts';
import type { Settings } from '../settings.ts';
import { FONT_STACK, branchFill, lifeSpanLabel, palette, sexColors, sexStripColor } from './palette.ts';

type GSelection = Selection<SVGGElement, unknown, null, undefined>;

let measureContext: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

/**
 * Width of `text` at the chart font, measured on a canvas: no layout reflow per
 * cell, and the canvas lays the same font out to the same width. This is the
 * `Measure` the layout sizes its rings and cells with.
 */
export const measureText: Measure = (text, fontSize, bold) => {
  const key = `${bold ? 7 : 4}|${fontSize}|${text}`;
  let width = widthCache.get(key);
  if (width === undefined) {
    measureContext ??= document.createElement('canvas').getContext('2d');
    if (measureContext) {
      measureContext.font = `${bold ? 700 : 400} ${fontSize}px ${FONT_STACK}`;
      width = measureContext.measureText(text).width;
    } else {
      width = text.length * fontSize * 0.55;
    }
    widthCache.set(key, width);
  }
  return width;
};

/** Forget measured widths — a web font has loaded and widths changed. */
export function resetMeasurements(): void {
  widthCache.clear();
}

/** The text as it fits `maxWidth` — whole, or cut with an ellipsis; '' when not even one letter fits. */
function fitText(text: string, maxWidth: number, fontSize: number, bold: boolean): string {
  if (measureText(text, fontSize, bold) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(`${text.slice(0, mid).trimEnd()}…`, fontSize, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '';
}

function personTitle(person: PersonRef): string {
  const span = lifeSpanLabel(person.birthYear, person.deathYear);
  return span ? `${person.name} (${span})` : person.name;
}

/**
 * A card of the cards style written across the ring: a rectangle in its row
 * (`Cell.row` — the cards of one node on one band, flush side by side), as wide
 * as the cell is at its inner edge. Straight sides read as a card; a ring
 * segment would fan out like a wedge.
 */
function cardRect(layout: Layout, cell: Cell, row: { u0: number; u1: number }, d0: number, d1: number): string {
  const at = (u: number, d: number) => rowPoint(layout.track, row, cell.d0, u, d);
  const corners = [at(cell.u0, d0), at(cell.u1, d0), at(cell.u1, d1), at(cell.u0, d1)];
  return corners.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('') + 'Z';
}

/** True when text running along +x rotated by `deg` would appear upside down. */
function needsFlip(deg: number): boolean {
  const normalized = ((deg % 360) + 360) % 360;
  return normalized > 90 && normalized < 270;
}

/** One line of a cell's text, in the cell's own frame. */
interface TextLine {
  key: 'name' | 'years';
  text: string;
  size: number;
  weight: number;
  color: string;
  /** Arc text: the path it runs on. */
  path?: string;
  /** Radial text: transform of the line. */
  transform?: string;
}

interface CellView {
  cell: Cell;
  shape: string;
  fill: string;
  stroke: string;
  strip: string | null;
  stripColor: string | null;
  lines: TextLine[];
  title: string;
}

export interface RendererEvents {
  /** A cell with a union of its own was clicked: re-root the chart on that union. */
  onSelectFamily?: (familyId: string) => void;
}

/**
 * Owns the SVG scene: builds the static skeleton once, then re-renders any
 * (layout, settings) pair through keyed D3 joins. Zoom state survives updates.
 */
export class TreeRenderer {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly zoomLayer: GSelection;
  private readonly ringLayer: GSelection;
  private readonly linkLayer: GSelection;
  private readonly cellLayer: GSelection;
  private readonly coreLayer: GSelection;
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private viewWidth = 900;
  private viewHeight = 900;
  private layout: Layout | null = null;
  private search = '';
  /** Outline width of the cells, restored after a search highlight. */
  private cellStrokeWidth = 1;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, private readonly events: RendererEvents = {}) {
    this.svg = select(container)
      .append('svg')
      .attr('xmlns', 'http://www.w3.org/2000/svg')
      .attr('font-family', FONT_STACK)
      .attr('class', 'chart-svg');

    this.zoomLayer = this.svg.append('g').attr('class', 'zoom-layer');
    this.ringLayer = this.zoomLayer.append('g').attr('class', 'rings');
    this.linkLayer = this.zoomLayer.append('g').attr('class', 'links');
    this.cellLayer = this.zoomLayer.append('g').attr('class', 'cells');
    this.coreLayer = this.zoomLayer.append('g').attr('class', 'core');

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 12])
      .on('zoom', (event) => {
        this.zoomLayer.attr('transform', event.transform.toString());
      });
    this.svg.call(this.zoomBehavior).on('dblclick.zoom', null);

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      this.resize(entry.contentRect.width, entry.contentRect.height);
    });
    this.resizeObserver.observe(container);
    this.resize(container.clientWidth, container.clientHeight);
  }

  /** Stops observing the container and removes the SVG (the page is unmounting). */
  destroy(): void {
    this.resizeObserver.disconnect();
    this.svg.interrupt().on('.zoom', null).remove();
  }

  get element(): SVGSVGElement {
    return this.svg.node()!;
  }

  private resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.viewWidth = width;
    this.viewHeight = height;
    this.svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [-width / 2, -height / 2, width, height].join(' '));
  }

  update(layout: Layout, settings: Settings): void {
    this.layout = layout;
    this.svg.style('background-color', settings.canvasColor ?? null);
    this.renderRings(layout, settings);
    this.renderLinks(layout, settings);
    this.renderCells(layout, settings);
    this.renderCore(layout, settings);
    this.applySearch();
  }

  /** Scales and centers the drawing so the whole tree is visible. */
  fitToContent(bounds: Layout['bounds'], animate = true): void {
    const padding = 24;
    const k = Math.min(
      (this.viewWidth - padding * 2) / Math.max(bounds.width, 1),
      (this.viewHeight - padding * 2) / Math.max(bounds.height, 1),
      1.5
    );
    const scale = Math.max(k, 0.02);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const transform = zoomIdentity.scale(scale).translate(-cx, -cy);
    const target = animate ? this.svg.transition().duration(400) : this.svg;
    target.call(this.zoomBehavior.transform, transform);
  }

  /** Centers the view on a point of the drawing at a readable zoom. */
  focus(point: { x: number; y: number }, scale = 2): void {
    const transform = zoomIdentity.scale(scale).translate(-point.x, -point.y);
    this.svg.transition().duration(500).call(this.zoomBehavior.transform, transform);
  }

  /**
   * Marks the cells whose names contain `query` (case-insensitive) and returns
   * the middle of the first match, to zoom to; null when nothing matches.
   */
  setSearch(query: string): { x: number; y: number } | null {
    this.search = query.trim().toLocaleLowerCase();
    this.applySearch();
    if (!this.search || !this.layout) return null;
    const layout = this.layout;
    const hit = layout.cells.find((c) => c.person.name.toLocaleLowerCase().includes(this.search));
    if (hit) return pointAt(layout.track, (hit.u0 + hit.u1) / 2, (hit.d0 + hit.d1) / 2);
    const core = layout.core.people.find((p) => p.name.toLocaleLowerCase().includes(this.search));
    return core ? layout.core.center : null;
  }

  /** How many drawn people match the current search. */
  searchCount(): number {
    if (!this.search || !this.layout) return 0;
    const q = this.search;
    return (
      this.layout.cells.filter((c) => c.person.name.toLocaleLowerCase().includes(q)).length +
      this.layout.core.people.filter((p) => p.name.toLocaleLowerCase().includes(q)).length
    );
  }

  private renderRings(layout: Layout, settings: Settings): void {
    const full = layout.span.end - layout.span.start >= 1 - 1e-9;
    this.ringLayer
      .selectAll<SVGPathElement, number>('path')
      .data(settings.showRings ? layout.rings.map((r) => (r.inner + r.outer) / 2) : [])
      .join('path')
      .attr('d', (d) => (full ? trackPath(layout.track, d) : arcLinePath(layout.track, layout.span.start, layout.span.end, d)))
      .attr('fill', 'none')
      .attr('stroke', settings.ringColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 7');
  }

  private renderLinks(layout: Layout, settings: Settings): void {
    this.linkLayer
      .selectAll<SVGPathElement, Link>('path')
      .data(layout.links, (d) => d.key)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', settings.lineColor)
      .attr('stroke-width', settings.lineWidth)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('d', (d) => polylinePath(d.points));
  }

  private cellView(cell: Cell, layout: Layout, settings: Settings): CellView {
    const { track } = layout;
    const bold = settings.boldFont;
    const weight = bold ? 700 : 400;
    const sex = sexColors(cell.person.sex, settings);
    const byBranch = settings.colorMode === 'branch';
    const fill = byBranch
      ? branchFill(cell.branch, layout.branches.count, cell.depth - layout.branches.depth, cell.role === 'spouse')
      : sex.fill;
    const stripColor = !settings.showSexStrip
      ? null
      : byBranch
        ? sexStripColor(cell.person.sex, settings)
        : cell.role === 'blood'
          ? sex.accent
          : null;
    const row = cell.row;
    const shapeOf = (d0: number, d1: number) =>
      row ? cardRect(layout, cell, row, d0, d1) : bandPath(track, cell.u0, cell.u1, d0, d1);
    const stripDepth = Math.min(3, (cell.d1 - cell.d0) / 4);
    const strip = stripColor && stripDepth > 0.5 ? shapeOf(cell.d0, cell.d0 + stripDepth) : null;

    const years = settings.showYears ? yearsLabel(cell.person) : null;
    const nameSize = cell.fontSize;
    const yearsSize = settings.fontSize * 0.78;
    const nameH = nameSize * 1.25;
    const yearsH = yearsSize * 1.2;
    const lines: TextLine[] = [];
    const name = fitText(shownName(cell.person, settings), cell.along, nameSize, bold);
    const withYears = years !== null && cell.across >= nameH + yearsH * 0.9 && measureText(years, yearsSize, false) <= cell.along;
    const total = nameH + (withYears ? yearsH : 0);

    const mid = (cell.u0 + cell.u1) / 2;
    // A card in a row is turned with its row, not with its own spot on the ring.
    const { normal } = locate(track, row ? (row.u0 + row.u1) / 2 : mid, (cell.d0 + cell.d1) / 2);
    if (cell.orient === 'arc') {
      // Along the ring, left to right: on the lower half the path runs backwards,
      // and "up" (the first line) then points inwards.
      const flip = Math.sin(normal) > 1e-6;
      const dm = (cell.d0 + cell.d1) / 2;
      const nameD = dm + (flip ? -1 : 1) * (total / 2 - nameH / 2);
      const yearsD = dm - (flip ? -1 : 1) * (total / 2 - yearsH / 2);
      // A textPath places and turns every glyph on its own, and repaints that
      // way on every zoom step — by far the costliest text in the chart. Where
      // the ring under a line is nearly flat (its sag over the line's width,
      // w²/8r, under 1.5 px) a straight line along the tangent looks the same.
      const tangent = (normal * 180) / Math.PI + 90;
      const upright = needsFlip(tangent) ? tangent + 180 : tangent;
      const place = (text: string, size: number, bold: boolean, d: number): Pick<TextLine, 'path' | 'transform'> => {
        const width = measureText(text, size, bold);
        if ((width * width) / (8 * Math.max(d, 1)) > 1.5) {
          return { path: flip ? arcLinePath(track, cell.u1, cell.u0, d) : arcLinePath(track, cell.u0, cell.u1, d) };
        }
        const at = pointAt(track, mid, d);
        return { transform: `translate(${at.x.toFixed(2)},${at.y.toFixed(2)}) rotate(${upright.toFixed(2)})` };
      };
      if (name) {
        lines.push({ key: 'name', text: name, size: nameSize, weight, color: palette.text, ...place(name, nameSize, bold, nameD) });
      }
      if (withYears) {
        lines.push({ key: 'years', text: years!, size: yearsSize, weight: 400, color: palette.mutedText, ...place(years!, yearsSize, false, yearsD) });
      }
    } else {
      // Across the ring, reading outwards on the right half and inwards on the left.
      const deg = (normal * 180) / Math.PI;
      const flip = needsFlip(deg);
      const dm = (cell.d0 + cell.d1) / 2;
      const at = row ? rowPoint(track, row, cell.d0, mid, dm) : pointAt(track, mid, dm);
      const rotate = flip ? deg + 180 : deg;
      const offset = (dy: number) => `translate(${at.x.toFixed(2)},${at.y.toFixed(2)}) rotate(${rotate.toFixed(2)}) translate(0,${dy.toFixed(2)})`;
      if (name) lines.push({ key: 'name', text: name, size: nameSize, weight, color: palette.text, transform: offset(withYears ? -(total / 2 - nameH / 2) : 0) });
      if (withYears) {
        lines.push({ key: 'years', text: years!, size: yearsSize, weight: 400, color: palette.mutedText, transform: offset(total / 2 - yearsH / 2) });
      }
    }
    return {
      cell,
      shape: shapeOf(cell.d0, cell.d1),
      fill,
      stroke: settings.borderColor,
      strip,
      stripColor,
      lines,
      title: personTitle(cell.person)
    };
  }

  private renderCells(layout: Layout, settings: Settings): void {
    const ids = new Map<string, number>();
    const idOf = (key: string) => {
      let id = ids.get(key);
      if (id === undefined) ids.set(key, (id = ids.size));
      return `tp${id}`;
    };
    const views = layout.cells.map((cell) => this.cellView(cell, layout, settings));

    const cellSel = this.cellLayer
      .selectAll<SVGGElement, CellView>('g.cell')
      .data(views, (d) => d.cell.key)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'cell');
        g.append('path').attr('class', 'cell-bg');
        g.append('path').attr('class', 'cell-strip');
        // The outline goes over the strip, so the strip never covers it.
        g.append('path').attr('class', 'cell-outline');
        g.append('g').attr('class', 'cell-text');
        g.append('title');
        return g;
      })
      .attr('cursor', (d) => (d.cell.familyId ? 'pointer' : null));

    cellSel
      .select<SVGPathElement>('path.cell-bg')
      .attr('d', (d) => d.shape)
      .attr('fill-rule', 'evenodd')
      .attr('fill', (d) => d.fill);

    cellSel
      .select<SVGPathElement>('path.cell-outline')
      .attr('d', (d) => d.shape)
      .attr('fill', 'none')
      .attr('stroke', (d) => d.stroke)
      .attr('stroke-width', (this.cellStrokeWidth = settings.chartStyle === 'fan' ? 1 : 0.8));

    cellSel
      .select<SVGPathElement>('path.cell-strip')
      .attr('display', (d) => (d.strip ? null : 'none'))
      .attr('d', (d) => d.strip ?? '')
      .attr('fill-rule', 'evenodd')
      .attr('fill', (d) => d.stripColor ?? 'none');

    const textSel = cellSel.select<SVGGElement>('g.cell-text');
    textSel.each(function (view) {
      const group = select(this);
      const lines = view.lines;
      // Arc lines run on a path of their own, referenced by id from a textPath.
      group
        .selectAll<SVGPathElement, TextLine>('path.text-run')
        .data(lines.filter((l) => l.path), (l) => l.key)
        .join('path')
        .attr('class', 'text-run')
        .attr('id', (l) => `${idOf(view.cell.key)}${l.key}`)
        .attr('d', (l) => l.path!)
        .attr('fill', 'none')
        .attr('stroke', 'none');
      group
        .selectAll<SVGTextElement, TextLine>('text')
        .data(lines, (l) => `${l.key}|${l.path ? 'arc' : 'radial'}`)
        .join('text')
        .attr('font-size', (l) => l.size.toFixed(2))
        .attr('font-weight', (l) => l.weight)
        .attr('fill', (l) => l.color)
        .attr('dominant-baseline', 'central')
        .attr('text-anchor', 'middle')
        .attr('transform', (l) => l.transform ?? null)
        .each(function (l) {
          const text = select(this);
          if (l.path) {
            text
              .selectAll('textPath')
              .data([l])
              .join('textPath')
              .attr('href', `#${idOf(view.cell.key)}${l.key}`)
              .attr('startOffset', '50%')
              .text(l.text);
          } else {
            text.selectAll('textPath').remove();
            text.text(l.text);
          }
        });
    });

    cellSel.select('title').text((d) => d.title);

    cellSel
      .on('click', (_event, d) => {
        if (d.cell.familyId) this.events.onSelectFamily?.(d.cell.familyId);
      });
  }

  /** Outlines the cells whose names match the search, and fades the rest. */
  private applySearch(): void {
    const q = this.search;
    const matches = (cell: Cell) => q !== '' && cell.person.name.toLocaleLowerCase().includes(q);
    this.cellLayer.classed('searching', q !== '');
    const cells = this.cellLayer.selectAll<SVGGElement, CellView>('g.cell').classed('match', (d) => matches(d.cell));
    cells
      .select<SVGPathElement>('path.cell-outline')
      .attr('stroke', (d) => (matches(d.cell) ? palette.highlight : d.stroke))
      .attr('stroke-width', (d) => (matches(d.cell) ? 2.5 : this.cellStrokeWidth));
    cells.filter((d) => matches(d.cell)).raise();
  }

  /**
   * The core: the root family, a disc (or the sector of a partial fan, or a
   * pill on a stadium) cut into one horizontal band per spouse.
   */
  private renderCore(layout: Layout, settings: Settings): void {
    const { core, track, span } = layout;
    const r = core.radius;
    const shape = bandPath(track, span.start, span.end, 0, r);
    const rows = core.people;
    const m = Math.max(rows.length, 1);
    const full = span.end - span.start >= 1 - 1e-9;

    const rootSel = this.coreLayer
      .selectAll<SVGGElement, number>('g.root-node')
      .data([0])
      .join((enter) => {
        const g = enter.append('g').attr('class', 'root-node');
        g.append('clipPath').attr('id', 'core-clip').append('path');
        g.append('path').attr('class', 'halo');
        g.append('g').attr('class', 'bands').attr('clip-path', 'url(#core-clip)');
        g.append('path').attr('class', 'outline');
        g.append('g').attr('class', 'labels');
        g.append('title');
        return g;
      });

    rootSel.select('clipPath path').attr('d', shape);
    rootSel
      .select<SVGPathElement>('path.halo')
      .attr('d', full ? trackPath(track, r + 4) : bandPath(track, span.start, span.end, 0, r + 4))
      .attr('fill', '#ffffff')
      .attr('stroke', palette.rootHalo)
      .attr('stroke-width', 1);

    // Rows stacked around the core's centroid, as tall as the core allows.
    const height = full ? 2 * r : r * 1.1;
    const bandHeight = Math.min(height / m, r);
    const top = core.center.y - (bandHeight * m) / 2;
    const extentX = track.half + r;
    const byBranch = settings.colorMode === 'branch';
    rootSel
      .select('g.bands')
      .selectAll<SVGRectElement, PersonRef>('rect')
      .data(rows, (d) => d.id)
      .join('rect')
      .attr('x', -extentX)
      .attr('width', 2 * extentX)
      // The first and last bands run on to the core's edge.
      .attr('y', (_d, i) => (i === 0 ? -r - track.half : top + i * bandHeight))
      .attr('height', (_d, i) => {
        const y0 = i === 0 ? -r - track.half : top + i * bandHeight;
        const y1 = i === m - 1 ? r + track.half : top + (i + 1) * bandHeight;
        return y1 - y0;
      })
      .attr('fill', (d) => (byBranch ? palette.trunk : sexColors(d.sex, settings).fill));
    rootSel
      .select('g.bands')
      .selectAll<SVGLineElement, number>('line')
      .data(rows.slice(1).map((_d, i) => top + (i + 1) * bandHeight))
      .join('line')
      .attr('x1', -extentX)
      .attr('x2', extentX)
      .attr('y1', (y) => y)
      .attr('y2', (y) => y)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    rootSel
      .select<SVGPathElement>('path.outline')
      .attr('d', shape)
      .attr('fill', 'none')
      .attr('stroke', palette.rootHalo)
      .attr('stroke-width', 1.2);

    /** Half the core's width at height y (from the spine). */
    const halfWidthAt = (y: number) => track.half + Math.sqrt(Math.max(r * r - y * y, 0));
    const years = (p: PersonRef) => (settings.showYears ? yearsLabel(p) : null);
    const fontFor = (p: PersonRef, i: number) => {
      const y = top + (i + 0.5) * bandHeight;
      const room = 2 * halfWidthAt(Math.abs(y) + bandHeight * 0.3) * 0.86;
      const base = Math.min(bandHeight * 0.42, settings.fontSize * 2.6);
      const width = measureText(shownName(p, settings), base, true);
      return Math.max(Math.min(base, (base * room) / Math.max(width, 1)), 5);
    };
    const labels = rows.map((p, i) => ({ person: p, size: fontFor(p, i), y: top + (i + 0.5) * bandHeight }));
    const size = Math.min(...labels.map((l) => l.size));
    rootSel
      .select('g.labels')
      .selectAll<SVGTextElement, (typeof labels)[number]>('text.name')
      .data(labels, (d) => d.person.id)
      .join('text')
      .attr('class', 'name')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('x', 0)
      .attr('y', (d) => d.y - (years(d.person) ? size * 0.35 : 0))
      .attr('font-size', size.toFixed(2))
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text((d) => shownName(d.person, settings));
    rootSel
      .select('g.labels')
      .selectAll<SVGTextElement, (typeof labels)[number]>('text.years')
      .data(
        labels.filter((l) => years(l.person)),
        (d) => d.person.id
      )
      .join('text')
      .attr('class', 'years')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('x', 0)
      .attr('y', (d) => d.y + size * 0.55)
      .attr('font-size', (size * 0.55).toFixed(2))
      .attr('fill', palette.mutedText)
      .text((d) => years(d.person)!);

    rootSel.select('title').text(rows.map(personTitle).join('\n'));
  }
}
