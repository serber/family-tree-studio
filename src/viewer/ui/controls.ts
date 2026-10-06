import { t } from '../i18n.ts';
import type { Settings } from '../settings.ts';

type KeysOfType<T, V> = { [K in keyof T]-?: T[K] extends V ? K : never }[keyof T];
export type NumericSettingKey = KeysOfType<Settings, number>;
export type BooleanSettingKey = KeysOfType<Settings, boolean>;
export type StringSettingKey = KeysOfType<Settings, string>;

export interface RangeControl {
  kind: 'range';
  key: NumericSettingKey;
  /** i18n key of the visible label. */
  labelKey: string;
  /** Bounds in display units (see toValue/toDisplay). */
  min: number;
  max: number;
  step?: number;
  /** Maps display units → stored value (e.g. 85% → 0.85). Identity by default. */
  toValue?: (display: number) => number;
  toDisplay?: (value: number) => number;
  format?: (display: number) => string;
}

export interface ColorControl {
  kind: 'color';
  key: StringSettingKey;
  labelKey: string;
}

export interface ToggleControl {
  kind: 'toggle';
  key: BooleanSettingKey;
  labelKey: string;
}

/** A choice between named values; each option's label is `<labelKey>.<value>`. */
export interface SelectControl {
  kind: 'select';
  key: StringSettingKey;
  labelKey: string;
  options: string[];
}

/** How many inner rings write along the arc: «auto» or 0…the number of rings on the chart. */
export interface ArcRingsControl {
  kind: 'arcRings';
}

export type ControlDef = RangeControl | ColorControl | ToggleControl | SelectControl | ArcRingsControl;

/** What the panel needs to know about the chart on screen. */
export interface ChartInfo {
  /** Number of rings outside the core. */
  rings: number;
  /** Rings the automatic choice writes along the arc. */
  autoArcRings: number;
}

export interface ControlGroup {
  titleKey: string;
  open?: boolean;
  controls: ControlDef[];
}

export const controlGroups: ControlGroup[] = [
  {
    titleKey: 'groups.layout',
    open: true,
    controls: [
      { kind: 'select', key: 'chartStyle', labelKey: 'controls.chartStyle', options: ['fan', 'cards'] },
      { kind: 'range', key: 'fanAngle', labelKey: 'controls.fanAngle', min: 180, max: 360, step: 10, format: (v) => `${v}°` },
      {
        kind: 'range',
        key: 'shapeStretch',
        labelKey: 'controls.shapeStretch',
        min: 100,
        max: 300,
        step: 5,
        toValue: (v) => v / 100,
        toDisplay: (v) => Math.round(v * 100),
        format: (v) => `${v}%`
      },
      {
        kind: 'range',
        key: 'compactness',
        labelKey: 'controls.compactness',
        min: 0,
        max: 100,
        step: 5,
        toValue: (v) => v / 100,
        toDisplay: (v) => Math.round(v * 100),
        format: (v) => `${v}%`
      },
      { kind: 'arcRings' },
      { kind: 'range', key: 'cardSpacing', labelKey: 'controls.cardSpacing', min: 0, max: 40 },
      { kind: 'range', key: 'familyGap', labelKey: 'controls.familyGap', min: 0, max: 80 },
      { kind: 'range', key: 'ringGap', labelKey: 'controls.ringGap', min: 0, max: 60 }
    ]
  },
  {
    titleKey: 'groups.card',
    open: true,
    controls: [
      { kind: 'range', key: 'fontSize', labelKey: 'controls.fontSize', min: 6, max: 26 },
      { kind: 'toggle', key: 'boldFont', labelKey: 'controls.boldFont' },
      { kind: 'toggle', key: 'givenNamesOnly', labelKey: 'controls.givenNamesOnly' },
      { kind: 'toggle', key: 'showYears', labelKey: 'controls.showYears' },
      { kind: 'toggle', key: 'showBothSpouses', labelKey: 'controls.showBothSpouses' },
      { kind: 'toggle', key: 'spousesBeside', labelKey: 'controls.spousesBeside' },
      { kind: 'range', key: 'cardLength', labelKey: 'controls.cardLength', min: 40, max: 320 },
      { kind: 'range', key: 'cardThickness', labelKey: 'controls.cardThickness', min: 8, max: 80 }
    ]
  },
  {
    titleKey: 'groups.style',
    open: false,
    controls: [
      { kind: 'select', key: 'colorMode', labelKey: 'controls.colorMode', options: ['branch', 'sex'] },
      { kind: 'toggle', key: 'showSexStrip', labelKey: 'controls.showSexStrip' },
      { kind: 'color', key: 'maleColor', labelKey: 'controls.maleColor' },
      { kind: 'color', key: 'femaleColor', labelKey: 'controls.femaleColor' },
      { kind: 'color', key: 'borderColor', labelKey: 'controls.borderColor' },
      { kind: 'color', key: 'lineColor', labelKey: 'controls.lineColor' },
      { kind: 'range', key: 'lineWidth', labelKey: 'controls.lineWidth', min: 0.2, max: 6, step: 0.1 },
      { kind: 'toggle', key: 'showRings', labelKey: 'controls.showRings' },
      { kind: 'color', key: 'ringColor', labelKey: 'controls.ringColor' },
      { kind: 'color', key: 'canvasColor', labelKey: 'controls.canvasColor' }
    ]
  }
];

/**
 * Builds the settings panel DOM; every change writes into `settings` and calls `onChange`.
 * Idempotent: re-running (e.g. after a locale switch) replaces the previous panel
 * and keeps each group's collapsed/expanded state.
 */
export function buildSettingsPanel(
  container: HTMLElement,
  settings: Settings,
  onChange: () => void,
  chart: ChartInfo
): void {
  const previousOpen = [...container.querySelectorAll('details')].map((d) => d.open);
  container.replaceChildren();

  controlGroups.forEach((group, index) => {
    const details = document.createElement('details');
    details.className = 'settings-group';
    details.open = previousOpen[index] ?? group.open ?? false;

    const summary = document.createElement('summary');
    summary.textContent = t(group.titleKey);
    details.append(summary);

    const body = document.createElement('div');
    body.className = 'settings-group-body';
    for (const def of group.controls) {
      body.append(createControl(def, settings, onChange, chart));
    }
    details.append(body);
    container.append(details);
  });
}

function createControl(def: ControlDef, settings: Settings, onChange: () => void, chart: ChartInfo): HTMLElement {
  switch (def.kind) {
    case 'arcRings':
      return createArcRings(settings, onChange, chart);
    case 'select':
      return createSelect(def, settings, onChange);
    case 'range':
      return createRange(def, settings, onChange);
    case 'color':
      return createColor(def, settings, onChange);
    case 'toggle':
      return createToggle(def, settings, onChange);
  }
}

function controlShell(label: string): { root: HTMLLabelElement; head: HTMLDivElement; output: HTMLOutputElement } {
  const root = document.createElement('label');
  root.className = 'control';
  const head = document.createElement('div');
  head.className = 'control-head';
  const span = document.createElement('span');
  span.textContent = label;
  const output = document.createElement('output');
  head.append(span, output);
  root.append(head);
  return { root, head, output };
}

function createRange(def: RangeControl, settings: Settings, onChange: () => void): HTMLElement {
  const toDisplay = def.toDisplay ?? ((v: number) => v);
  const toValue = def.toValue ?? ((v: number) => v);
  const format = def.format ?? ((v: number) => String(v));

  const { root, output } = controlShell(t(def.labelKey));
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step ?? 1);
  input.value = String(toDisplay(settings[def.key]));
  output.textContent = format(toDisplay(settings[def.key]));

  input.addEventListener('input', () => {
    const display = Number(input.value);
    if (Number.isNaN(display)) return;
    settings[def.key] = toValue(display);
    output.textContent = format(display);
    onChange();
  });

  root.append(input);
  return root;
}

function selectShell(label: string, options: { value: string; label: string }[], value: string): { root: HTMLElement; select: HTMLSelectElement } {
  const root = document.createElement('label');
  root.className = 'control control-select';
  const span = document.createElement('span');
  span.textContent = label;
  const select = document.createElement('select');
  select.className = 'input select';
  select.append(
    ...options.map((option) => {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      return el;
    })
  );
  select.value = value;
  root.append(span, select);
  return { root, select };
}

function createSelect(def: SelectControl, settings: Settings, onChange: () => void): HTMLElement {
  const { root, select } = selectShell(
    t(def.labelKey),
    def.options.map((value) => ({ value, label: t(`${def.labelKey}Options.${value}`) })),
    settings[def.key]
  );
  select.addEventListener('change', () => {
    (settings as unknown as Record<string, string>)[def.key] = select.value;
    onChange();
  });
  return root;
}

/**
 * «Names along the ring»: automatic (the layout picks the rings for which it
 * costs no size), or a fixed count of inner rings. Options follow the chart.
 */
function createArcRings(settings: Settings, onChange: () => void, chart: ChartInfo): HTMLElement {
  const options = [{ value: '-1', label: t('controls.arcRingsAuto', { count: chart.autoArcRings }) }];
  for (let n = 0; n <= chart.rings; n += 1) options.push({ value: String(n), label: String(n) });
  const current = settings.arcRings > chart.rings ? chart.rings : settings.arcRings;
  const { root, select } = selectShell(t('controls.arcRings'), options, String(current));
  select.addEventListener('change', () => {
    settings.arcRings = Number(select.value);
    onChange();
  });
  return root;
}

function createColor(def: ColorControl, settings: Settings, onChange: () => void): HTMLElement {
  const { root, output } = controlShell(t(def.labelKey));
  const input = document.createElement('input');
  input.type = 'color';
  input.value = settings[def.key];
  output.textContent = settings[def.key];

  input.addEventListener('input', () => {
    (settings as unknown as Record<string, string>)[def.key] = input.value;
    output.textContent = input.value;
    onChange();
  });

  root.append(input);
  return root;
}

function createToggle(def: ToggleControl, settings: Settings, onChange: () => void): HTMLElement {
  const root = document.createElement('label');
  root.className = 'control control-toggle';
  const span = document.createElement('span');
  span.textContent = t(def.labelKey);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'visually-hidden';
  input.checked = settings[def.key];
  const switchEl = document.createElement('span');
  switchEl.className = 'switch';

  input.addEventListener('change', () => {
    settings[def.key] = input.checked;
    onChange();
  });

  root.append(span, input, switchEl);
  return root;
}
