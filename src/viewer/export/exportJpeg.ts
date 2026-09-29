import { AppError } from '../../shared/errors.ts';
import type { PrintSize } from '../settings.ts';
import spectral400 from '@fontsource/spectral/400.css?inline';
import spectral600 from '@fontsource/spectral/600.css?inline';

/**
 * Renders the current SVG scene into a print-sized JPEG.
 * No external libraries: the SVG is serialized, loaded into an <img>
 * and rasterized through a canvas.
 */
export async function renderJpeg(
  svg: SVGSVGElement,
  bounds: { x: number; y: number; width: number; height: number },
  size: PrintSize,
  background: string
): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // Export ignores the on-screen zoom: show the whole tree, centered.
  clone.querySelector('.zoom-layer')?.removeAttribute('transform');

  // The drawing plus a 2 % margin, widened in one direction to the sheet's aspect.
  const width = Math.max(bounds.width, 1) * 1.04;
  const height = Math.max(bounds.height, 1) * 1.04;
  const aspect = size.width / size.height;
  const vbWidth = Math.max(width, height * aspect);
  const vbHeight = vbWidth / aspect;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  clone.setAttribute('viewBox', `${cx - vbWidth / 2} ${cy - vbHeight / 2} ${vbWidth} ${vbHeight}`);
  clone.setAttribute('width', String(size.width));
  clone.setAttribute('height', String(size.height));

  // The rasterizing <img> cannot load external fonts — embed Spectral as data URIs.
  // On failure the serif fallback from FONT_STACK applies.
  const fontCss = await chartFontCss();
  if (fontCss) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }

  const svgText = new XMLSerializer().serializeToString(clone);
  const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AppError('canvasUnavailable');
    ctx.fillStyle = background || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return await toJpegBlob(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Spectral's @font-face rules (self-hosted, the same faces the page uses). */
const FONT_CSS = [spectral400, spectral600].join('\n');

let fontCssPromise: Promise<string> | null = null;

/**
 * Spectral's @font-face rules with every woff2 file inlined as a data URI
 * (the woff fallbacks are dropped: every browser that runs the app reads woff2).
 * Cached; '' on failure.
 */
function chartFontCss(): Promise<string> {
  fontCssPromise ??= (async () => {
    let css = FONT_CSS.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]?woff['"]?\)/g, '');
    const urls = [...new Set([...css.matchAll(/url\((?!data:)['"]?([^)'"]+)['"]?\)/g)].map((m) => m[1]!))];
    for (const url of urls) {
      const buffer = await (await fetch(new URL(url, location.href))).arrayBuffer();
      css = css.replaceAll(url, `data:font/woff2;base64,${arrayBufferToBase64(buffer)}`);
    }
    return css;
  })().catch(() => {
    fontCssPromise = null;
    return '';
  });
  return fontCssPromise;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new AppError('rasterizeFailed'));
    image.src = url;
  });
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new AppError('jpegFailed'))),
      'image/jpeg',
      0.95
    );
  });
}
