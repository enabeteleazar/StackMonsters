import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/oswald/latin-400.css'
import '@fontsource/oswald/latin-500.css'
import '@fontsource/oswald/latin-600.css'
import '@fontsource/oswald/latin-700.css'
import '@fontsource/bebas-neue/latin-400.css'
import App from './App'
import Consentement from './components/Consentement'
import './styles.css'
import { initSuivi } from './suivi'

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <App />
    <Consentement />
  </StrictMode>,
)

initSuivi()

// PWA : le service worker met l'appli et la dernière collection en cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
