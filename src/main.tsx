import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App'
import './styles.css'
import { initSuivi } from './suivi'

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
)

initSuivi()

// PWA : le service worker met l'appli et la dernière collection en cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
