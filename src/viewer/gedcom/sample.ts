import { AppError } from '../../shared/errors.ts';
import { getLocale, type Locale } from '../../shared/i18n/index.ts';
import demoRu from '../../../examples/demo-family.ru.ged?url';
import demoEn from '../../../examples/demo-family.en.ged?url';

const files: Record<Locale, string> = { ru: demoRu, en: demoEn };
const samples = new Map<Locale, Promise<Uint8Array>>();

/**
 * The demo family shown on startup and by the Sample button, in the current language:
 * examples/demo-family.<locale>.ged, the same files the editor opens as its demo
 * (300 people, one progenitor couple). Fetched once per language; raw bytes,
 * decoded like any loaded file.
 */
export function loadSampleGedcom(): Promise<Uint8Array> {
  const locale = getLocale();
  let sample = samples.get(locale);
  if (!sample) {
    sample = fetch(files[locale])
      .then(async (response) => {
        if (!response.ok) throw new AppError('sampleUnavailable');
        return new Uint8Array(await response.arrayBuffer());
      })
      .catch((error: unknown) => {
        samples.delete(locale);
        throw error instanceof AppError ? error : new AppError('sampleUnavailable');
      });
    samples.set(locale, sample);
  }
  return sample;
}
