import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

/**
 * Writes the demo GEDCOM files from the editor's deterministic demo generator (`createDemo`):
 *
 * - examples/demo-family.ru.ged, examples/demo-family.en.ged — the product's demo family (300 people)
 *   in each language, opened by the editor's demo commands and shown by the visualizer;
 * - tests/fixtures/demo-3000.ged — the Russian family grown to 3,000 people, for the e2e scale test.
 *
 * Run with `npm run demo` after changing the generator; a unit test fails while the files are stale.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
try {
  const { DEMO_SIZE, demoGedcom } = await server.ssrLoadModule('/src/editor/model/demo.ts') as typeof import('../src/editor/model/demo')
  const files = [['examples/demo-family.ru.ged', 'ru', DEMO_SIZE], ['examples/demo-family.en.ged', 'en', DEMO_SIZE], ['tests/fixtures/demo-3000.ged', 'ru', 3000]] as const
  for (const [file, locale, count] of files) {
    const text = demoGedcom(locale, count)
    writeFileSync(resolve(root, file), text)
    console.log(`${file}: ${count} people, ${(text.length / 1024).toFixed(0)} KB`)
  }
} finally {
  await server.close()
}
