import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import '../shared/styles/index.css'
import './viewer.css'
import { ViewerApp } from './ViewerApp'
import { syncDocumentTitle } from '../shared/i18n'

syncDocumentTitle('viewer')

// The production HTML carries the pre-rendered markup (scripts/pages.ts): hydrate it.
// The dev server serves the bare template: render from scratch.
const root = document.getElementById('root')!
const app = <StrictMode><ViewerApp /></StrictMode>
if (root.firstElementChild) hydrateRoot(root, app)
else createRoot(root).render(app)
