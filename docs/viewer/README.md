# Visualizer documentation

The visualizer of Family Tree Studio (`/viewer/`): a radial family tree for GEDCOM files. The descendant tree is laid
out on generation rings around the root family — as a fan (every person a
cell over the sector of their descendants) or as cards joined by lines; the
result can be tuned for print and exported as JPEG (up to A0, 300 DPI).

## Contents

| Document | Covers |
| --- | --- |
| [architecture.md](architecture.md) | Modules, data flow, key decisions |
| [layout.md](layout.md) | Layout algorithm: ring modes, tidy packing, compactness, cells, lines |
| [gedcom.md](gedcom.md) | Supported GEDCOM subset and parser behavior |
| [settings.md](settings.md) | Reference for every panel setting |
| [export.md](export.md) | How the print-ready JPEG export works |
| [development.md](development.md) | Running, building, verifying changes |
| [../deployment.md](../deployment.md) | Deploying the whole product on an Ubuntu server (nginx) |

## Quick start

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173/viewer/ (or /ru/viewer/), click Sample («Пример») or drag & drop your own
`.ged` file onto the canvas. The root family can be changed in the dropdown —
progenitors (couples with no recorded parents) are listed first.
