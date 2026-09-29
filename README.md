# Family Tree Studio

A family tree editor and a radial family tree visualizer in one product — https://treestudio.app

- **Editor** (`/editor/`) — enter and verify a genealogy of up to ~3,000 people on one canvas: add relatives right on the tree, connect branches, catch transcription mistakes, review person by person, and save as GEDCOM. Russian patronymics, surname forms and dates are filled in automatically.
- **Visualizer** (`/viewer/`) — load a GEDCOM file and get a radial (circular) descendant chart, tune it for print and export a JPEG up to A0 at 300 DPI.

The whole interface is in English (`/…`) and Russian (`/ru/…`). Everything runs in the browser: files are parsed locally, the editor keeps its draft in the browser's storage, nothing is uploaded, and no third-party resources are loaded.

## Run

Node.js 22.12+ (Node 24 recommended) and npm.

```sh
npm ci
npm run dev        # http://127.0.0.1:5173 — home page, /editor/, /viewer/, /ru/…
npm run build      # typecheck + production build into dist/
npm test           # unit tests (Vitest)
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e   # browser tests (Playwright; or `npx playwright install chromium`)
```

## Stack

React 19, TypeScript, Vite (multi-page: one entry per page, shared code in `src/shared`). The editor uses React Flow and dagre with Web Workers for layout and GEDCOM; the visualizer draws SVG with D3. Translations are ICU messages (`messages/ru.json`, `messages/en.json`) formatted by intl-messageformat. Styles are plain CSS with cascade layers and design tokens (light and dark themes); fonts (Manrope, Spectral) are self-hosted.

## Documentation

| Document | Covers |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Structure, product-wide rules, invariants (also the agent instructions) |
| [docs/editor/](docs/editor/README.md) | Using the editor, status, plan, GEDCOM support |
| [docs/viewer/](docs/viewer/README.md) | Visualizer architecture, layout algorithm, settings, export |
| [docs/deployment.md](docs/deployment.md) | Deploying to Ubuntu + nginx |

## License

See [LICENSE](LICENSE).
