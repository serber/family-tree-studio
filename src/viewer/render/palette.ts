import { hsl } from 'd3';
import type { Sex } from '../gedcom/types.ts';
import { t } from '../i18n.ts';
import type { Settings } from '../settings.ts';

/** Chart typography is serif (Spectral); the export embeds it, Georgia is the fallback. */
export const FONT_STACK = "'Spectral', Georgia, 'Times New Roman', serif";

export const palette = {
  text: '#26324a',
  mutedText: '#5d6475',
  ring: '#d9d2c2',
  rootHalo: '#e6e0d3',
  /** The trunk: the core and the lone generations above the first branching. */
  trunk: '#e8dfca',
  highlight: '#0f766e',
  unknown: { fill: '#e9e6dd', accent: '#8a8579' }
} as const;

const accentCache = new Map<string, string>();

/** Derives the accent (sex strip) color from a card fill: same hue, darker and calmer. */
function accentFor(fill: string): string {
  let accent = accentCache.get(fill);
  if (!accent) {
    const c = hsl(fill);
    c.s = Number.isNaN(c.s) ? 0 : Math.min(c.s * 0.75, 1);
    c.l = Math.min(Math.max(c.l * 0.66, 0.25), 0.72);
    accent = c.formatHex();
    accentCache.set(fill, accent);
  }
  return accent;
}

export function sexColors(
  sex: Sex,
  settings: Pick<Settings, 'maleColor' | 'femaleColor' | 'borderColor'>
): { fill: string; accent: string; border: string } {
  const base =
    sex === 'M'
      ? { fill: settings.maleColor, accent: accentFor(settings.maleColor) }
      : sex === 'F'
        ? { fill: settings.femaleColor, accent: accentFor(settings.femaleColor) }
        : palette.unknown;
  return { ...base, border: settings.borderColor };
}

/** Color of the thin strip that marks sex on branch-colored cells; null when unknown. */
export function sexStripColor(sex: Sex, settings: Pick<Settings, 'maleColor' | 'femaleColor'>): string | null {
  if (sex === 'M') return accentFor(settings.maleColor);
  if (sex === 'F') return accentFor(settings.femaleColor);
  return null;
}

/**
 * Hue of branch `index` of `count`: spread evenly round the wheel, so every
 * branch stands apart; past twelve, stepping five twelfths at a time keeps
 * neighbours far apart while hues repeat.
 */
function branchHue(index: number, count: number): number {
  const step = count <= 12 ? 360 / Math.max(count, 1) : 150;
  return (28 + index * step) % 360;
}

const branchCache = new Map<string, string>();

/**
 * Fill of a cell colored by branch: the branch's hue, soft enough for dark text,
 * a touch lighter each generation outwards; spouses (married in) paler still.
 */
export function branchFill(branch: number, count: number, generation: number, spouse: boolean): string {
  if (branch < 0) return palette.trunk;
  const key = `${branch}|${count}|${generation}|${spouse}`;
  let fill = branchCache.get(key);
  if (!fill) {
    const hue = branchHue(branch, count);
    const light = 0.8 + Math.min(generation, 8) * 0.012 + (spouse ? 0.05 : 0);
    fill = hsl(hue, spouse ? 0.3 : 0.42, Math.min(light, 0.94)).formatHex();
    branchCache.set(key, fill);
  }
  return fill;
}

export function lifeSpanLabel(birthYear: number | null, deathYear: number | null): string | null {
  if (birthYear !== null && deathYear !== null) return `${birthYear}–${deathYear}`;
  if (birthYear !== null) return t('life.born', { year: birthYear });
  if (deathYear !== null) return t('life.died', { year: deathYear });
  return null;
}
