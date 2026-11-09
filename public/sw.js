// Service worker StackMonster : coquille de l'appli + dernière liste en cache.
const V = 'sm-v2'
const COQUILLE = ['/', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(COQUILLE)))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const garder = (req, res) => {
  if (res.ok) {
    const copie = res.clone()
    caches.open(V).then((c) => c.put(req, copie))
  }
  return res
}

self.addEventListener('fetch', (e) => {
  const r = e.request
  const u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== location.origin) return

  if (u.pathname.startsWith('/api/')) {
    // Seules la liste et les photos déjà vues sont gardées hors ligne ; le reste exige le réseau.
    if (u.pathname === '/api/cans') {
      e.respondWith(
        fetch(r).then((res) => garder(r, res)).catch(() => caches.match(r).then((m) => m || Response.error())),
      )
    } else if (/^\/api\/cans\/[^/]+\/photo$/.test(u.pathname)) {
      // L'adresse porte la version de la photo : une réponse gardée reste valable. « Se déconnecter » vide ce cache.
      e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => garder(r, res))))
    }
    return
  }

  // Page : réseau d'abord (mises à jour), cache en secours.
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => garder('/', res)).catch(() => caches.match('/')))
    return
  }

  // Fichiers au nom haché : cache d'abord.
  e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => garder(r, res))))
})
