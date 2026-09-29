/** How the chart is drawn: one layout, two looks. */
export type ChartStyle = 'fan' | 'cards';

/** What the cell fill encodes. */
export type ColorMode = 'branch' | 'sex';

/** Visual & layout settings, adjustable from the side panel. */
export interface Settings {
  // ---- Layout -------------------------------------------------------------
  /**
   * `fan`: every person is a cell spanning the whole sector of their
   * descendants (a sunburst) — parentage shows by nesting, no lines needed.
   * `cards`: a card of its own size in the middle of that sector, joined to
   * the parent by a smooth line.
   */
  chartStyle: ChartStyle;
  /** Opening of the chart in degrees: 360 is a full disc, 180 a half-fan standing on its base. */
  fanAngle: number;
  /**
   * Width : height of the chart. 1 draws circles; above 1 the rings become
   * stadiums (half circles joined by straight sides) around a central spine.
   */
  shapeStretch: number;
  /**
   * How many inner rings write names along the ring rather than across it.
   * −1 = decide automatically: a ring goes along the arc while that doesn't
   * make the chart bigger (sparse inner generations become thin bands).
   */
  arcRings: number;
  /**
   * 0…1: how far the chart may shrink below the tidy layout (every parent
   * centered over its children). At 1 each ring is only as large as its own
   * cells need and cells slide sideways to fit; at 0 nothing slides.
   */
  compactness: number;
  /** Arc length (px) kept free between neighbouring cells on a ring. */
  cardSpacing: number;
  /** Extra arc length (px) between the children of two different families. */
  familyGap: number;
  /** Radial gap (px) between rings; the cards style adds room for its lines. */
  ringGap: number;

  // ---- Cell ---------------------------------------------------------------
  /** Longest radial extent (px) of a cell written across the ring; names longer than that are cut. */
  cardLength: number;
  /** Least tangential extent (px) of a cell written across the ring. */
  cardThickness: number;
  fontSize: number;
  /** Render names in bold. */
  boldFont: boolean;
  /** Years of life under the name, where there is room. */
  showYears: boolean;
  showBothSpouses: boolean;
  /**
   * Spouses beside their partner on the same ring (one cell each, side by
   * side) instead of in an outer band of the ring.
   */
  spousesBeside: boolean;

  // ---- Style --------------------------------------------------------------
  /** `branch`: each main branch its own hue, sex as a thin strip; `sex`: fill by sex. */
  colorMode: ColorMode;
  maleColor: string;
  femaleColor: string;
  /** Cell outline color. */
  borderColor: string;
  lineColor: string;
  lineWidth: number;
  /** A thin strip in the sex color at the inner edge of every cell. */
  showSexStrip: boolean;
  /** Dashed generation rings. */
  showRings: boolean;
  /** Color of the dashed generation rings. */
  ringColor: string;
  /** Background color of the drawing canvas (screen and export). */
  canvasColor: string;
}

export const defaultSettings: Settings = {
  chartStyle: 'fan',
  fanAngle: 360,
  shapeStretch: 1,
  arcRings: -1,
  compactness: 0.5,
  cardSpacing: 3,
  familyGap: 8,
  ringGap: 4,

  cardLength: 150,
  cardThickness: 18,
  fontSize: 12,
  boldFont: false,
  showYears: true,
  showBothSpouses: true,
  spousesBeside: false,

  colorMode: 'branch',
  maleColor: '#d8e7f8',
  femaleColor: '#fadbe7',
  borderColor: '#fbf9f4',
  lineColor: '#b7bccb',
  lineWidth: 1.2,
  showSexStrip: true,
  showRings: false,
  ringColor: '#d9d2c2',
  canvasColor: '#f7f4ee'
};

export interface PrintSize {
  /** Also the i18n key of the visible label: `printSizes.<key>`. */
  key: string;
  width: number;
  height: number;
}

/** Export canvas presets: landscape print formats at 300 DPI plus screen sizes. */
export const PRINT_SIZES: readonly PrintSize[] = [
  { key: 'a3', width: 4961, height: 3508 },
  { key: 'a2', width: 7016, height: 4961 },
  { key: 'a1', width: 9933, height: 7016 },
  { key: 'a0', width: 14043, height: 9933 },
  { key: 'fullhd', width: 1920, height: 1080 },
  { key: '4k', width: 3840, height: 2160 },
  { key: 'square', width: 2400, height: 2400 }
];
