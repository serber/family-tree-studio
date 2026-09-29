import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import '../shared/styles/index.css'
import './landing.css'
import { Landing } from './Landing'

// The production HTML carries the pre-rendered page (see scripts/pages.ts): hydrate it.
// The dev server serves the bare template: render from scratch.
const root = document.getElementById('root')!
const app = <StrictMode><Landing /></StrictMode>
if (root.firstElementChild) hydrateRoot(root, app)
else createRoot(root).render(app)
