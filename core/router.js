// Hash router: '#expenses' → 'expenses'. Unknown or empty → 'home'.
export const ROUTES = ['home', 'expenses', 'prefs'];

export function route(hash) {
  const r = String(hash || '').replace(/^#\/?/, '');
  return ROUTES.includes(r) ? r : 'home';
}

// Calls fn(view) now and on every hash change. Returns an unsubscribe function.
export function onRoute(fn) {
  const h = () => fn(route(location.hash));
  addEventListener('hashchange', h);
  h();
  return () => removeEventListener('hashchange', h);
}
