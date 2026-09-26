const CACHE_NAME = 'agentic-task-manager-pwa-v1.1.0';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './css/base.css',
  './css/workspace.css',
  './css/features.css',
  './css/pwa.css',
  './css/visual-polish.css',
  './css/responsive.css',
  './js/app/main.js',
  './js/app/render-route.js',
  './js/app/router.js',
  './js/domain/parser.js',
  './js/domain/project-setup.js',
  './js/domain/writer.js',
  './js/features/activity/activity-view.js',
  './js/features/agents/agent-control-view.js',
  './js/features/knowledge/knowledge-view.js',
  './js/features/projects/projects-view.js',
  './js/features/questions/questions-view.js',
  './js/features/queue/queue-view.js',
  './js/features/settings/settings-view.js',
  './js/features/task-detail/task-detail-view.js',
  './js/features/verification/verification-view.js',
  './js/lib/utils.js',
  './js/services/automation-control.js',
  './js/services/browser-cleanup.js',
  './js/services/project-service.js',
  './js/services/server-fs.js',
  './js/state/runtime-config.js',
  './js/state/store.js',
  './js/ui/components.js',
  './js/ui/markdown.js',
  './js/ui/view-helpers.js',
  './js/ui/views.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];
const APP_SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.location.href).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (APP_SHELL_URLS.has(url.href)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
  }
});
