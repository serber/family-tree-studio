import { AppError } from '../shared/errors.ts';
import { decodeGedcom } from './gedcom/decode.ts';
import { parseGedcom } from './gedcom/parser.ts';
import { loadSampleGedcom } from './gedcom/sample.ts';
import type { GedcomData } from './gedcom/types.ts';
import { onLocaleChange } from '../shared/i18n/index.ts';
import { t } from './i18n.ts';
import { buildTree, listRootCandidates, type DescendantTree, type TreeNode } from './tree/build.ts';
import { computeLayout, type Layout } from './layout/fan.ts';
import { TreeRenderer, measureText, resetMeasurements } from './render/renderer.ts';
import { downloadBlob, renderJpeg } from './export/exportJpeg.ts';
import { PRINT_SIZES, defaultSettings, type PrintSize, type Settings } from './settings.ts';
import { buildSettingsPanel } from './ui/controls.ts';

/** The DOM the visualizer drives; rendered by `ViewerApp`, filled imperatively from here. */
export interface ViewerElements {
  root: HTMLElement;
  chart: HTMLDivElement;
  status: HTMLSpanElement;
  fileInput: HTMLInputElement;
  sampleBtn: HTMLButtonElement;
  rootSelect: HTMLSelectElement;
  settingsPanel: HTMLDivElement;
  printSizeSelect: HTMLSelectElement;
  exportBtn: HTMLButtonElement;
  fitBtn: HTMLButtonElement;
  legendUnknown: HTMLSpanElement;
  searchInput: HTMLInputElement;
  backBtn: HTMLButtonElement;
}

/** True when some drawn person has no known sex (their cards use the neutral color). */
function hasUnknownSex(node: TreeNode): boolean {
  return node.spouses.some((p) => p.sex === 'U') || node.children.some(hasUnknownSex);
}

/** Settings that only color or stroke the drawing; everything else can move it. */
const STYLE_ONLY: ReadonlySet<keyof Settings> = new Set<keyof Settings>([
  'colorMode',
  'maleColor',
  'femaleColor',
  'borderColor',
  'lineColor',
  'lineWidth',
  'showRings',
  'ringColor',
  'canvasColor',
  'showSexStrip'
]);

/**
 * Starts the visualizer on the given elements: GEDCOM text → tree → layout → SVG.
 * Returns the teardown that removes every listener and the SVG.
 */
export function mountViewer(el: ViewerElements): () => void {
  const settings: Settings = { ...defaultSettings };
  let data: GedcomData | null = null;
  let tree: DescendantTree | null = null;
  let layout: Layout | null = null;
  const cleanups: (() => void)[] = [];

  function listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void
  ): void {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** Roots the user came from by clicking into a branch, most recent last. */
  const rootHistory: string[] = [];

  const renderer = new TreeRenderer(el.chart, {
    // Clicking a person re-roots the chart on their union: their branch alone.
    onSelectFamily: (familyId) => {
      if (!tree || familyId === tree.root.id) return;
      rootHistory.push(tree.root.id);
      selectRoot(familyId, true);
    }
  });
  cleanups.push(() => renderer.destroy());

  function errorMessage(error: unknown): string {
    if (error instanceof AppError) return t(`errors.${error.code}`, error.params);
    return (error as Error).message;
  }

  function setStatus(message: string, isError = false): void {
    el.status.textContent = message;
    el.status.classList.toggle('error', isError);
  }

  function showStats(): void {
    if (!tree) return;
    const parts = [
      t('status.stats', {
        people: tree.peopleCount,
        families: tree.familyCount,
        generations: tree.maxGeneration + 1
      })
    ];
    const query = el.searchInput.value.trim();
    if (query) parts.push(t('status.found', { count: renderer.searchCount() }));
    setStatus(parts.join(' · '));
  }

  /** What the panel last showed about the chart: its rings and the automatic arc count. */
  let panelChart = '';
  let autoArcRings = 0;

  function chartInfo() {
    if (layout && settings.arcRings < 0) autoArcRings = layout.rings.filter((r) => r.mode === 'arc').length;
    return { rings: layout?.rings.length ?? 0, autoArcRings };
  }

  /** (Re)builds the settings panel — its ring choices follow the chart on screen. */
  function buildPanel(): void {
    const info = chartInfo();
    panelChart = JSON.stringify(info);
    buildSettingsPanel(el.settingsPanel, settings, onSettingsChange, info);
  }

  let lastLayoutKey = '';
  let lastLayoutTree: DescendantTree | null = null;
  /** Bumped when a web font loads: text widths, and so the layout, change. */
  let fontEpoch = 0;

  function layoutKey(): string {
    const geometry = Object.entries(settings).filter(([k]) => !STYLE_ONLY.has(k as keyof Settings));
    return `${fontEpoch}|${JSON.stringify(geometry)}`;
  }

  function rerender(): void {
    // Keep the sidebar legend swatches in sync with the card colors.
    el.root.style.setProperty('--legend-male', settings.maleColor);
    el.root.style.setProperty('--legend-female', settings.femaleColor);
    if (!tree) return;
    // Colors and strokes don't move anything: reuse the layout unless the tree,
    // a geometry setting or the measured font changed.
    const key = layoutKey();
    if (!layout || key !== lastLayoutKey || tree !== lastLayoutTree) {
      layout = computeLayout(tree, settings, measureText);
      lastLayoutKey = key;
      lastLayoutTree = tree;
    }
    renderer.update(layout, settings);
    renderer.setSearch(el.searchInput.value);
    // Another tree or root changes the rings the panel offers.
    if (JSON.stringify(chartInfo()) !== panelChart) buildPanel();
  }

  let pendingFrame = 0;
  cleanups.push(() => cancelAnimationFrame(pendingFrame));

  /**
   * A settings control changed: re-layout and refresh the status line — once per
   * frame. A dragged slider fires faster than a large tree lays out; handling
   * every event would queue them up and the chart would trail the slider.
   */
  function onSettingsChange(): void {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      rerender();
      showStats();
    });
  }

  function selectRoot(familyId: string, fit: boolean): void {
    if (!data) return;
    try {
      tree = buildTree(data, familyId);
      el.legendUnknown.hidden = !hasUnknownSex(tree.root);
      if (el.rootSelect.value !== familyId && [...el.rootSelect.options].some((o) => o.value === familyId)) {
        el.rootSelect.value = familyId;
      }
      el.backBtn.hidden = rootHistory.length === 0;
      rerender();
      if (fit && layout) renderer.fitToContent(layout.bounds, false);
      showStats();
    } catch (error) {
      setStatus(t('status.error', { message: errorMessage(error) }), true);
    }
  }

  function populateRootSelect(): void {
    if (!data) return;
    const selected = el.rootSelect.value;
    const candidates = listRootCandidates(data);
    el.rootSelect.replaceChildren(
      ...candidates.map((candidate) => {
        const option = document.createElement('option');
        option.value = candidate.familyId;
        option.textContent = t('status.rootOption', { label: candidate.label, count: candidate.descendants });
        return option;
      })
    );
    el.rootSelect.disabled = candidates.length === 0;
    if (candidates.some((c) => c.familyId === selected)) el.rootSelect.value = selected;
  }

  function loadGedcom(text: string): void {
    try {
      data = parseGedcom(text);
    } catch (error) {
      setStatus(t('status.error', { message: errorMessage(error) }), true);
      return;
    }
    rootHistory.length = 0;
    populateRootSelect();
    const first = el.rootSelect.options[0];
    if (first) {
      el.rootSelect.value = first.value;
      selectRoot(first.value, true);
    }
  }

  let unmounted = false;
  cleanups.push(() => {
    unmounted = true;
  });

  /** Loads the demo family (fetched once); a failure shows in the status line. */
  function loadSample(): void {
    loadSampleGedcom().then(
      (bytes) => {
        if (!unmounted) loadGedcom(decodeGedcom(bytes));
      },
      (error: unknown) => {
        if (!unmounted) setStatus(t('status.error', { message: errorMessage(error) }), true);
      }
    );
  }

  function readFile(file: File): void {
    const reader = new FileReader();
    // Raw bytes, not readAsText: the encoding varies by program (see decodeGedcom).
    reader.onload = () => {
      if (!unmounted) loadGedcom(decodeGedcom(new Uint8Array(reader.result as ArrayBuffer)));
    };
    reader.onerror = () => {
      if (!unmounted) setStatus(t('status.readFileError'), true);
    };
    reader.readAsArrayBuffer(file);
  }

  function setupDataInputs(): void {
    listen(el.fileInput, 'change', () => {
      const file = el.fileInput.files?.[0];
      if (file) readFile(file);
      el.fileInput.value = '';
    });

    listen(el.sampleBtn, 'click', loadSample);

    listen(el.rootSelect, 'change', () => {
      rootHistory.length = 0;
      selectRoot(el.rootSelect.value, true);
    });

    listen(el.backBtn, 'click', () => {
      const previous = rootHistory.pop();
      if (previous) selectRoot(previous, true);
    });

    listen(el.searchInput, 'input', () => {
      renderer.setSearch(el.searchInput.value);
      showStats();
    });
    listen(el.searchInput, 'keydown', (event) => {
      if (event.key !== 'Enter') return;
      const hit = renderer.setSearch(el.searchInput.value);
      if (hit) renderer.focus(hit);
    });

    // Drag & drop of a .ged file onto the chart.
    listen(el.chart, 'dragover', (event) => {
      event.preventDefault();
      el.chart.classList.add('dragover');
    });
    listen(el.chart, 'dragleave', () => el.chart.classList.remove('dragover'));
    listen(el.chart, 'drop', (event) => {
      event.preventDefault();
      el.chart.classList.remove('dragover');
      const file = event.dataTransfer?.files?.[0];
      if (file) readFile(file);
    });
  }

  function sizeLabel(size: PrintSize): string {
    return t(`printSizes.${size.key}`);
  }

  function populatePrintSizes(): void {
    const selected = el.printSizeSelect.value || 'a1';
    el.printSizeSelect.replaceChildren(
      ...PRINT_SIZES.map((size) => {
        const option = document.createElement('option');
        option.value = size.key;
        option.textContent = sizeLabel(size);
        return option;
      })
    );
    el.printSizeSelect.value = PRINT_SIZES.some((s) => s.key === selected) ? selected : 'a1';
  }

  function setupExport(): void {
    populatePrintSizes();

    listen(el.exportBtn, 'click', async () => {
      if (!layout) {
        setStatus(t('status.loadFirst'), true);
        return;
      }
      const size = PRINT_SIZES.find((s) => s.key === el.printSizeSelect.value) ?? PRINT_SIZES[0]!;
      el.exportBtn.disabled = true;
      setStatus(t('status.exporting', { size: sizeLabel(size) }));
      try {
        const blob = await renderJpeg(renderer.element, layout.bounds, size, settings.canvasColor);
        downloadBlob(blob, `family-tree-${size.key}.jpg`);
        setStatus(t('status.saved', { size: sizeLabel(size) }));
      } catch (error) {
        console.error(error);
        setStatus(t('status.exportError', { message: errorMessage(error) }), true);
      } finally {
        el.exportBtn.disabled = false;
      }
    });
  }

  /** Re-applies every string this module wrote in the current locale; the static markup is React's. */
  function applyLocale(): void {
    buildPanel();
    populatePrintSizes();
    populateRootSelect();
    rerender(); // card tooltips contain translated life-year labels
    showStats();
  }

  setupDataInputs();
  setupExport();
  cleanups.push(onLocaleChange(applyLocale));
  listen(el.fitBtn, 'click', () => {
    if (layout) renderer.fitToContent(layout.bounds);
  });

  // Cells are sized by measured text; until Spectral arrives that is the fallback
  // serif, so measure (and lay out) again once it — or its bold face — loads.
  const onFontsLoaded = () => {
    resetMeasurements();
    fontEpoch += 1;
    rerender();
  };
  document.fonts?.addEventListener('loadingdone', onFontsLoaded);
  cleanups.push(() => document.fonts?.removeEventListener('loadingdone', onFontsLoaded));

  applyLocale();
  loadSample();

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
