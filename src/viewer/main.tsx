import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/styles/index.css'
import './viewer.css'
import { ViewerApp } from './ViewerApp'
import { syncDocumentTitle } from '../shared/i18n'

syncDocumentTitle('viewer')

createRoot(document.getElementById('root')!).render(<StrictMode><ViewerApp /></StrictMode>)
