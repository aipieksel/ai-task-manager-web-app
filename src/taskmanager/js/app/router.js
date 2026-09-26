const KNOWN_ROUTES = new Set([
  '/',
  '/task',
  '/questions',
  '/verification',
  '/activity',
  '/agents',
  '/lessons',
  '/observations',
  '/projects',
  '/settings',
]);

export function currentRoute() {
  const raw = window.location.hash.slice(1) || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = KNOWN_ROUTES.has(pathPart) ? pathPart : '/';
  return { path, params: new URLSearchParams(queryPart) };
}

export function navigate(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query}` : '';
  window.location.hash = `${path}${suffix}`;
}

export function listen(callback) {
  const handler = () => callback(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
