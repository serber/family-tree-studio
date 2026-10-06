# Settings reference

All settings live in the `Settings` type (`src/viewer/settings.ts`); the panel is
generated from the `controlGroups` descriptors (`src/viewer/ui/controls.ts`).
Changing any setting recomputes the layout and updates the SVG; zoom state is
preserved. Panel labels come from `messages/{en,ru}.json` (`viewer.controls.*` and
`groups.*` keys); the Russian variants are listed below next to each key.

The three tables below mirror the three panel groups, in panel order. How the
layout uses them is in [layout.md](layout.md).

## Layout («Компоновка»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Вид | `chartStyle` | Веер / Карточки и линии (`fan` / `cards`) | `fan` | **Fan**: every person is a cell reaching over the sector of their descendants — parentage reads from the nesting, no lines. **Cards**: a card of its own size, joined to its parent by a line; rings keep room for the lines between them |
| Раскрытие | `fanAngle` | 180–360° (step 10) | 360° | The opening of the chart. 360° is a full disc; less is a fan standing on its base and opening upwards — 180° is the classic half-fan, wide and low, good for a landscape sheet |
| Вытянутость (100% — круг) | `shapeStretch` | 100–300 % (step 5) | 100 % | Width : height of the rings; stored as 1.0–3.0. At 100 % they are circles; above it stadiums round a straight central spine, where generations stand in columns along the sides |
| Плотность | `compactness` | 0–100 % (step 5) | 50 % | How far the chart may shrink below the tidy layout. At 0 every parent stays exactly centered over its children; at 100 % each ring is only as large as its own cells need and cells slide sideways to fit. Neighbours never overlap and (cards) lines never cross at any value |
| Имена вдоль кольца | `arcRings` | авто, 0…rings on the chart | авто (−1) | How many inner rings write names along the ring (thin bands, for sparse generations) rather than across it. «авто (N)» shows how many the automatic choice took: rings go along the arc from the center out while that keeps the chart about as small |
| Зазор между ячейками | `cardSpacing` | 0–40 | 3 | Arc length (px) kept free between neighbouring cells on a ring — guaranteed. The cards style adds 8 px (`CARD_AIR`): fan cells are tiles meant to touch, cards that close read as one strip |
| Зазор между семьями | `familyGap` | 0–80 | 8 | Extra arc length between the children of different families (cousins), and between the children of different unions of one person |
| Зазор между кольцами | `ringGap` | 0–60 | 4 | Radial gap between rings. The cards style adds 26 px for its lines |

## Cell («Ячейка»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Размер шрифта | `fontSize` | 6–26 | 12 | Base name size. Every text is measured (canvas `measureText`), and rings and cells are sized to fit; a cell written along the ring that came out roomy grows its name up to 2.2× |
| Жирный шрифт | `boldFont` | on/off | off | Names at weight 700 |
| Показывать только имя | `givenNamesOnly` | on/off | off | On: names without the surname — the part of `NAME` between slashes, else `GIVN` (`Иван Петрович /Леснов/` → «Иван Петрович»). Cells and rings are re-measured for the shorter names. Hover titles and search still use the full name |
| Годы жизни | `showYears` | on/off | on | Years under the name («1890–1960», «*1890», «†1960») wherever there is room; arc rings get a second line for them |
| Показывать супругов | `showBothSpouses` | on/off | on | Spouses as cells of their own in an outer band of the ring (split between unions for someone married several times). Off: descendants only |
| Супруги рядом | `spousesBeside` | on/off | off | Spouses stand beside their partner on the same ring, shoulder to shoulder (the descendant first), instead of in an outer band. In the cards style this is the earlier look: a union's line leaves from the seam between the partners' cards. The ring is then one band, as thick as the longest name of either |
| Наибольшая длина ячейки | `cardLength` | 40–320 | 150 | Cap on the radial thickness of a ring written across: it is as thick as its longest name, but no thicker than this; longer names are cut with «…» |
| Наименьшая ширина ячейки | `cardThickness` | 8–80 | 18 | Least width of a cell written across the ring (never less than a text line) |

## Style («Стиль»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Цвет | `colorMode` | По ветвям / По полу (`branch` / `sex`) | `branch` | **By branch**: each main branch (from the first generation of three or more) its own hue, lighter outwards, spouses paler; sex is a thin strip at the cell's inner edge. **By sex**: the fills below |
| Полоса пола | `showSexStrip` | on/off | on | The thin strip in the sex color at each cell's inner edge (drawn under the cell outline) |
| Цвет — мужчина | `maleColor` | color | `#d8e7f8` | Fill of male cells by sex; the sex strip color is derived from it |
| Цвет — женщина | `femaleColor` | color | `#fadbe7` | Same for female cells |
| Цвет рамки | `borderColor` | color | `#fbf9f4` | Cell outline — near-white by default, so cells read as separated tiles |
| Цвет линии | `lineColor` | color | `#b7bccb` | Lines of the cards style |
| Толщина линии | `lineWidth` | 0.2–6 (step 0.1) | 1.2 | Same |
| Кольца поколений | `showRings` | on/off | off | Dashed guide line along the middle of every ring |
| Цвет колец | `ringColor` | color | `#d9d2c2` | Color of those guides |
| Цвет холста | `canvasColor` | color | `#f7f4ee` | Chart background, on screen and in the export |

## Not settings

Some geometry that looks tunable is deliberately fixed in code:

| Constant | Where | Value | Meaning |
| --- | --- | --- | --- |
| core radius | `baseCore`, `src/viewer/layout/fan.ts` | derived | Fits the root names; grows when the outer rings need to sit further out (see [layout.md](layout.md#how-far-out-the-rings-go)) |
| `LINK_ROOM` | `src/viewer/layout/fan.ts` | 26 | Radial room the cards style keeps between rings for its lines |
| `CARD_AIR` | `src/viewer/layout/fan.ts` | 8 | Extra room between neighbouring cards in the cards style, on top of `cardSpacing` |
| `MAX_FONT_SCALE` | `src/viewer/layout/fan.ts` | 2.2 | Largest growth of a name in a roomy cell |
| `ARC_TOLERANCE` | `src/viewer/layout/fan.ts` | 4 % | How much larger the chart may get for a ring to still go along the arc (auto) |
| text, trunk, highlight and unknown-sex colors | `palette`, `src/viewer/render/palette.ts` | fixed | Not exposed in the panel on purpose |

## Export sizes

`PRINT_SIZES` (`src/viewer/settings.ts`) is the canvas preset list for the JPEG
export, not part of `Settings`. Each `key` doubles as the i18n key of the
visible label (`printSizes.<key>`). See [export.md](export.md).

| Key | Size (px) | Kind |
| --- | --- | --- |
| `a3` | 4961×3508 | landscape print, 300 DPI |
| `a2` | 7016×4961 | landscape print, 300 DPI |
| `a1` | 9933×7016 | landscape print, 300 DPI |
| `a0` | 14043×9933 | landscape print, 300 DPI |
| `fullhd` | 1920×1080 | screen |
| `4k` | 3840×2160 | screen |
| `square` | 2400×2400 | screen |

## Adding a new setting

1. Add a field to the `Settings` interface and a value to `defaultSettings`
   (`src/viewer/settings.ts`).
2. Add a descriptor to the appropriate `controlGroups` group
   (`src/viewer/ui/controls.ts`): `range` (with optional `toValue`/`toDisplay`/
   `format` — see `shapeStretch`, which stores 1.4 but shows «140 %»), `color`,
   `toggle` or `select` (a string union; each option's label is
   `controls.<key>Options.<value>`).
3. Add the label under `viewer.controls.<key>` in both `messages/en.json` and
   `messages/ru.json` — the descriptor carries a `labelKey`, never literal text.
4. Consume the value in `computeLayout` and/or `TreeRenderer.update`.

No need to touch `ViewerApp.tsx` — the panel is built from descriptors, and key
types are checked by the compiler: `NumericSettingKey`, `BooleanSettingKey`
and `StringSettingKey` are derived from `Settings`, so a control can only point
at a field of the matching type.

## Colors and font

Branch colors (`branchFill`, `src/viewer/render/palette.ts`): hues spread evenly
round the wheel for up to twelve branches (past twelve they step five twelfths
at a time, so neighbours still differ), saturation 42 %, lightness from 80 %
growing a little each generation outwards; spouses are paler and less
saturated. The trunk — the core and the lone generations above the first
branching — is a fixed warm neutral (`palette.trunk`).

Male/female fills are configurable via the pickers (see above); the sex strip
color is not chosen separately — it is derived from the fill (same hue,
darker and less saturated, `accentFor`, memoised per fill). The cell stroke is
*not* derived: it always comes from `borderColor`. Cells of unknown sex use a
fixed gray from `palette.unknown` (and get no strip); the legend shows a third
«Пол не указан» swatch only when the drawn tree contains such people. The sidebar legend syncs with the chosen colors via
the `--legend-male`/`--legend-female` CSS variables. Text and ring-guide colors are fixed in
the same `palette` constant and are deliberately not exposed in the panel.

Typography: the UI uses Manrope (like the whole product), the chart uses
Spectral; both are self-hosted (`@fontsource`), Spectral is imported by
`viewer.css`. `FONT_STACK` falls back to Georgia. The
export embeds Spectral into the serialized SVG — see [export.md](export.md).
