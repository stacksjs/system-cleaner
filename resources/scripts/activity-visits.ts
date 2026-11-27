import { sectionForPath } from '../lib/sections'

let previousPath = ''

function recordVisit(initial: boolean): void {
  const route = location.pathname.replace(/\/+$/, '')
  if (route === previousPath || (route !== '/app/settings' && !sectionForPath(route))) return
  previousPath = route
  void fetch('/api/activity-visit', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route, initial: initial && route !== '/app/settings' }),
  }).catch(() => {})
}

recordVisit(true)
window.addEventListener('stx:navigate', () => queueMicrotask(() => recordVisit(false)))
