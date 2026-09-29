import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/styles/index.css'
import './styles/index.css'
import App from './App'
import { syncDocumentTitle } from '../shared/i18n'

syncDocumentTitle('editor')

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
